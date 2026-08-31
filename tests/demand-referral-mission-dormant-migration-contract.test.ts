import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const legacyTables = [
  "searches",
  "search_intents",
  "demand_signals",
  "unmet_demand",
  "missions",
  "mission_progress",
] as const;

const definitionTables = [
  "demand_gap_definitions",
  "referral_mission_definitions",
] as const;

const forbiddenSurface = [
  "profile",
  "referrer",
  "visitor",
  "search",
  "evidence",
  "assignment",
  "progress",
  "copy",
  "json",
  "consent",
  "attribution",
  "reward",
  "finance",
  "payment",
  "ledger",
  "ai",
] as const;

function migration() {
  const directory = resolve(process.cwd(), "supabase", "migrations");
  const names = readdirSync(directory).filter((entry) =>
    /^202608310034_.*\.sql$/.test(entry),
  );
  if (names.length !== 1) {
    throw new Error(
      `Expected exactly one Step 26 migration 202608310034_*.sql, found ${names.length}`,
    );
  }
  return readFileSync(resolve(directory, names[0]), "utf8");
}

function quarantineMigration() {
  const directory = resolve(process.cwd(), "supabase", "migrations");
  const names = readdirSync(directory).filter((entry) =>
    /^202608310033_.*\.sql$/.test(entry),
  );
  if (names.length !== 1) {
    throw new Error(
      `Expected exactly one legacy quarantine migration 202608310033_*.sql, found ${names.length}`,
    );
  }
  return readFileSync(resolve(directory, names[0]), "utf8");
}

function probe() {
  return readFileSync(
    resolve(
      process.cwd(),
      "supabase",
      "tests",
      "demand_referral_mission_dormant_probe.sql",
    ),
    "utf8",
  );
}

function compact(sql: string) {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim()
    .toLowerCase();
}

function createdPrivateRelations(sql: string) {
  return (sql.match(/create table private\.[a-z_][a-z0-9_]*/g) ?? []).map(
    (entry) => entry.replace("create table private.", ""),
  );
}

function privateTableDefinition(sql: string, table: string) {
  const match = sql.match(
    new RegExp(`create table private\\.${table} \\((.*?)\\);`),
  );
  if (!match) throw new Error(`Missing private.${table} definition`);
  return match[1];
}

describe("dormant demand-gap and referral-mission definitions migration contract", () => {
  it("requires and preserves the exact six-table legacy quarantine before adding definitions", () => {
    const legacy = compact(quarantineMigration());
    const sql = compact(migration());

    expect(legacy).toContain(
      "legacy search, demand, and mission state is dormant",
    );
    expect(legacy).toContain(
      "private.prevent_dormant_demand_mission_mutation()",
    );
    expect(legacy.match(/create trigger [a-z_]+_dormant_/g) ?? []).toHaveLength(
      12,
    );
    for (const table of legacyTables) {
      expect(legacy).toContain(`public.${table}`);
      expect(legacy).toContain(
        `alter table public.${table} force row level security`,
      );
      expect(legacy).toContain(`${table}_dormant_rows`);
      expect(legacy).toContain(`${table}_dormant_truncate`);
    }

    expect(sql).toContain("set local lock_timeout");
    expect(sql).toContain("set local statement_timeout");
    const lockStart = sql.indexOf("lock table");
    const preconditionsStart = sql.indexOf("do $$");
    expect(lockStart).toBeGreaterThanOrEqual(0);
    expect(lockStart).toBeLessThan(preconditionsStart);
    const lockSection = sql.slice(lockStart, preconditionsStart);
    expect(lockSection).toContain("in share row exclusive mode");
    for (const table of legacyTables) {
      expect(lockSection).toContain(`public.${table}`);
      expect(sql).toContain(`exists (select 1 from public.${table})`);
    }
    expect(sql).toContain(
      "requires legacy search, demand, and mission quarantine",
    );
    expect(sql).toContain("private.prevent_dormant_demand_mission_mutation()");
  });

  it("creates exactly three private enum types and reuses the fixed merchant target", () => {
    const sql = compact(migration());

    expect(
      (
        sql.match(/create type private\.[a-z_][a-z0-9_]* as enum/g) ?? []
      ).sort(),
    ).toEqual(
      [
        "create type private.dormant_definition_status_code as enum",
        "create type private.demand_gap_kind_code as enum",
        "create type private.referral_mission_kind_code as enum",
      ].sort(),
    );
    expect(sql).toContain(
      "create type private.dormant_definition_status_code as enum ('draft', 'retired')",
    );
    expect(sql).toContain(
      "create type private.demand_gap_kind_code as enum ('merchant_supply_gap')",
    );
    expect(sql).toContain(
      "create type private.referral_mission_kind_code as enum ('merchant_recruitment')",
    );
    expect(sql).not.toContain("create type private.referral_target_code");
    expect(sql).toContain("private.referral_target_code not null");
    expect(sql).toContain("check (target = 'merchant_onboarding')");
    for (const type of [
      "dormant_definition_status_code",
      "demand_gap_kind_code",
      "referral_mission_kind_code",
    ]) {
      expect(sql).toContain(
        `revoke all on type private.${type} from public, anon, authenticated, service_role`,
      );
    }
  });

  it("models only immutable definition-version-one demand gaps and referral missions", () => {
    const sql = compact(migration());
    const demandGap = privateTableDefinition(sql, "demand_gap_definitions");
    const referralMission = privateTableDefinition(
      sql,
      "referral_mission_definitions",
    );

    expect(createdPrivateRelations(sql)).toEqual(definitionTables);
    expect(sql).not.toMatch(/create table public\./);
    expect(demandGap).toContain(
      "id uuid primary key default extensions.gen_random_uuid()",
    );
    expect(demandGap).toContain(
      "market_id uuid not null references public.markets(id) on delete restrict",
    );
    expect(demandGap).toContain(
      "category_id uuid not null references public.categories(id) on delete restrict",
    );
    expect(demandGap).toContain("kind private.demand_gap_kind_code not null");
    expect(demandGap).toContain("demand_key text not null");
    expect(demandGap).toContain("octet_length(demand_key) between 3 and 96");
    expect(demandGap).toContain(
      "demand_key ~ '^[a-z0-9][a-z0-9_-]{1,94}[a-z0-9]$'",
    );
    expect(demandGap).toContain(
      "status private.dormant_definition_status_code not null default 'draft'",
    );
    expect(demandGap).toContain(
      "definition_version smallint not null default 1 check (definition_version = 1)",
    );
    expect(demandGap).toContain(
      "created_at timestamptz not null default now()",
    );
    expect(demandGap).not.toContain("updated_at");
    expect(demandGap).toContain(
      "unique (market_id, category_id, kind, demand_key, definition_version)",
    );
    expect(sql).toMatch(
      /create index demand_gap_definitions_category_fkey_idx on private\.demand_gap_definitions\(category_id\)/,
    );

    expect(referralMission).toContain(
      "id uuid primary key default extensions.gen_random_uuid()",
    );
    expect(referralMission).toContain(
      "demand_gap_id uuid not null references private.demand_gap_definitions(id) on delete restrict",
    );
    expect(referralMission).toContain(
      "kind private.referral_mission_kind_code not null",
    );
    expect(referralMission).toContain(
      "target private.referral_target_code not null",
    );
    expect(referralMission).toContain("check (target = 'merchant_onboarding')");
    expect(referralMission).toContain(
      "status private.dormant_definition_status_code not null default 'draft'",
    );
    expect(referralMission).toContain(
      "definition_version smallint not null default 1 check (definition_version = 1)",
    );
    expect(referralMission).toContain(
      "created_at timestamptz not null default now()",
    );
    expect(referralMission).not.toContain("updated_at");
    expect(referralMission).toContain(
      "unique (demand_gap_id, kind, target, definition_version)",
    );
  });

  it("uses an exact private market/category validator and owner-dormant blockers", () => {
    const sql = compact(migration());

    expect(sql).toMatch(
      /create (?:or replace )?function private\.[a-z_]*demand[a-z_]*market[a-z_]*\(\) returns trigger language plpgsql security invoker set search_path = ''/,
    );
    expect(sql).toContain("category market mismatch");
    expect(sql).toContain("from public.markets");
    expect(sql).toContain("from public.categories");
    expect(sql).toContain("market_record.id = new.market_id");
    expect(sql).toContain("market_record.is_active");
    expect(sql).toContain("category_record.id = new.category_id");
    expect(sql).toContain("category_record.is_active");
    expect(sql).toContain("category_record.market_id is null");
    expect(sql).toContain("category_record.market_id = new.market_id");
    expect(sql).toMatch(
      /category_record\.market_id is null or category_record\.market_id = new\.market_id/,
    );
    expect(sql).toMatch(
      /before insert or update of market_id, category_id on private\.demand_gap_definitions/,
    );

    const blocker =
      "private.prevent_dormant_demand_referral_mission_mutation()";
    expect(sql).toContain(`create function ${blocker}`);
    expect(sql).toContain("returns trigger language plpgsql security invoker");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain(
      "demand-gap and referral-mission definitions are dormant",
    );
    expect(sql).toContain(`alter function ${blocker} owner to postgres`);
    expect(sql).toContain(
      `revoke all on function ${blocker} from public, anon, authenticated, service_role`,
    );
    for (const table of definitionTables) {
      expect(sql).toMatch(
        new RegExp(
          `create trigger ${table}_dormant_rows before insert or update or delete on private\\.${table} for each row execute function private\\.prevent_dormant_demand_referral_mission_mutation\\(\\)`,
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `create trigger ${table}_dormant_truncate before truncate on private\\.${table} for each statement execute function private\\.prevent_dormant_demand_referral_mission_mutation\\(\\)`,
        ),
      );
      expect(sql).toContain(
        `alter table private.${table} enable always trigger ${table}_dormant_rows`,
      );
      expect(sql).toContain(
        `alter table private.${table} enable always trigger ${table}_dormant_truncate`,
      );
    }
    expect(
      sql.match(
        /trigger_record\.tgfoid = 'private\.prevent_dormant_demand_referral_mission_mutation\(\)'::pg_catalog\.regprocedure/g,
      ) ?? [],
    ).toHaveLength(4);
    expect(
      sql.match(
        /trigger_record\.tgfoid = 'private\.validate_demand_gap_market_category\(\)'::pg_catalog\.regprocedure/g,
      ) ?? [],
    ).toHaveLength(1);
    const postconditions = sql.slice(sql.lastIndexOf("do $$"));
    expect(
      postconditions.match(/and not trigger_record\.tgisinternal\) <> [23]/g) ??
        [],
    ).toHaveLength(2);
  });

  it("is forced-RLS, policy-free, privilege-closed, and has no product activation surface", () => {
    const sql = compact(migration());

    for (const table of definitionTables) {
      expect(sql).toContain(
        `alter table private.${table} enable row level security`,
      );
      expect(sql).toContain(
        `alter table private.${table} force row level security`,
      );
      expect(sql).toContain(
        `revoke all on table private.${table} from public, anon, authenticated, service_role`,
      );
      expect(sql).toContain(`'private.${table}'::pg_catalog.regclass`);
    }
    expect(sql).not.toMatch(/\bcreate policy\b/);
    expect(sql).not.toMatch(/\bgrant\b/);
    expect(sql).not.toMatch(/create (?:or replace )?function public\./);
    expect(sql).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|merge\s+into|copy)\s+"?(?:public|private)"?\./,
    );
    expect(sql).not.toMatch(
      /\btruncate\s+(?:table\s+)?"?(?:public|private)"?\./,
    );
    expect(sql).not.toContain("jsonb");
    for (const term of forbiddenSurface) {
      expect(sql).not.toMatch(
        new RegExp(
          `create (?:table|(?:or replace )?function) (?:public|private)\\.[a-z_]*${term}[a-z_]*`,
        ),
      );
    }
  });

  it("ships a rollback-only hosted probe for metadata, denial, validators, and zero residue", () => {
    const sql = compact(probe());

    expect(sql).toMatch(/^begin;/);
    expect(sql).toMatch(/rollback;$/);
    expect(sql).toContain("set local lock_timeout");
    expect(sql).toContain("set local statement_timeout");
    expect(sql).toContain("set local transaction_timeout");
    const lockStart = sql.indexOf("lock table");
    const assertionStart = sql.indexOf("do $$");
    expect(lockStart).toBeGreaterThanOrEqual(0);
    expect(lockStart).toBeLessThan(assertionStart);
    const lockSection = sql.slice(lockStart, assertionStart);
    expect(lockSection).toContain("in access exclusive mode");
    expect(lockSection).toContain("private.demand_gap_definitions");
    expect(lockSection).toContain("private.referral_mission_definitions");
    expect(lockSection).not.toContain("public.markets");
    expect(lockSection).not.toContain("public.categories");
    for (const table of definitionTables) {
      expect(sql).toContain(`private.${table}`);
      expect(sql).toContain(`truncate private.${table} cascade`);
      expect(sql).toContain(`select count(*) from private.${table}`);
      expect(sql).toContain(`${table}_dormant_rows`);
      expect(sql).toContain(`${table}_dormant_truncate`);
    }
    for (const catalogCheck of [
      "pg_catalog.pg_attribute",
      "pg_catalog.pg_constraint",
      "pg_catalog.pg_index",
      "pg_catalog.pg_policies",
      "pg_catalog.pg_trigger",
      "pg_catalog.pg_proc",
      "pg_catalog.has_table_privilege",
      "pg_catalog.has_any_column_privilege",
      "pg_catalog.has_type_privilege",
      "pg_catalog.has_function_privilege",
      "relrowsecurity",
      "relforcerowsecurity",
      "confdeltype = 'r'",
      "tgenabled = 'a'",
      "trigger_record.tgfoid =",
    ]) {
      expect(sql).toContain(catalogCheck);
    }
    expect(sql).toContain("set local role anon");
    expect(sql).toContain("set local role authenticated");
    expect(sql).toContain("set local role service_role");
    expect(sql).toContain("insufficient_privilege");
    expect(sql).toContain("set local role postgres");
    expect(sql).toContain(
      "disable trigger demand_gap_definitions_dormant_rows",
    );
    expect(sql).toContain(
      "enable always trigger demand_gap_definitions_dormant_rows",
    );
    expect(sql).toContain(
      "disable trigger referral_mission_definitions_dormant_rows",
    );
    expect(sql).toContain(
      "enable always trigger referral_mission_definitions_dormant_rows",
    );
    expect(sql).toContain("invalid demand key");
    expect(sql).toContain("category market mismatch");
    expect(sql).toContain(
      "duplicate demand gap definition version unexpectedly worked",
    );
    expect(sql).toContain(
      "duplicate referral mission definition version unexpectedly worked",
    );
    expect(sql).toContain("unique_violation");
    expect(sql).toContain(
      "demand-gap and referral-mission definitions are dormant",
    );
    expect(sql).toContain(
      "generated public types unexpectedly include dormant definitions",
    );
    expect(sql).toContain(
      "public rpc unexpectedly references dormant definitions",
    );
    expect(sql).toContain(
      "left demand-gap or referral-mission fixture residue",
    );
    expect(sql).not.toContain("session_replication_role");
  });
});
