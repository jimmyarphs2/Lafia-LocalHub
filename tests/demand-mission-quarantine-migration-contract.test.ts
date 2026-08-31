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

const legacyPolicies = [
  ["searches", "searches_owner_select"],
  ["searches", "searches_owner_insert"],
  ["search_intents", "search_intents_owner"],
  ["search_intents", "search_intents_owner_insert"],
  ["mission_progress", "mission_progress_owner"],
] as const;

function migration() {
  const directory = resolve(process.cwd(), "supabase", "migrations");
  const names = readdirSync(directory).filter((entry) =>
    /^202608310033_.*\.sql$/.test(entry),
  );
  if (names.length !== 1) {
    throw new Error(
      `Expected exactly one Step 26 migration 202608310033_*.sql, found ${names.length}`,
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
      "demand_mission_quarantine_probe.sql",
    ),
    "utf8",
  );
}

function marketIntegrityProbe() {
  return readFileSync(
    resolve(
      process.cwd(),
      "supabase",
      "tests",
      "market_integrity_trigger_dispatch_probe.sql",
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

describe("legacy search, demand, and mission quarantine", () => {
  it("takes bounded access-exclusive locks in a fixed order before reading rows", () => {
    const sql = compact(migration());
    const lockStart = sql.indexOf("lock table");
    const preconditionsStart = sql.indexOf("do $$");

    expect(sql).toContain("set local lock_timeout");
    expect(sql).toContain("set local statement_timeout");
    expect(lockStart).toBeGreaterThanOrEqual(0);
    expect(lockStart).toBeLessThan(preconditionsStart);
    const lockSection = sql.slice(lockStart, preconditionsStart);
    expect(lockSection).toContain("in access exclusive mode");

    let previousPosition = -1;
    for (const table of legacyTables) {
      const position = lockSection.indexOf(`public.${table}`);
      expect(
        position,
        `${table} is missing from the fixed lock`,
      ).toBeGreaterThan(previousPosition);
      previousPosition = position;
    }
  });

  it("fails closed on rows, catalog drift, policies, ACLs, or changed FK actions", () => {
    const sql = compact(migration());

    for (const table of legacyTables) {
      expect(sql).toContain(`exists (select 1 from public.${table})`);
      expect(sql).toContain(`'public.${table}'::pg_catalog.regclass`);
    }
    expect(sql).toContain("using errcode = '55000'");
    expect(sql).toContain("requires empty legacy state");
    expect(sql).toContain("requires the exact legacy policy baseline");
    expect(sql).toContain("requires the exact legacy acl baseline");
    expect(sql).toContain("requires no legacy column acl drift");
    expect(sql).toContain("requires the exact legacy foreign-key baseline");
    expect(sql).toContain("pg_catalog.pg_policies");
    expect(sql).toContain("pg_catalog.has_table_privilege");
    expect(sql).toContain("pg_catalog.pg_attribute");
    expect(sql).toContain("pg_catalog.pg_constraint");
    expect(sql).toContain("pg_catalog.to_regprocedure");
    expect(sql).toContain("pg_catalog.pg_trigger");
    expect(sql).toContain("'maintain'");
    expect(sql).toContain("requires the exact legacy trigger baseline");
    expect(sql).toContain(
      "'public.validate_market_integrity()'::pg_catalog.regprocedure",
    );
    expect(sql).toMatch(
      /routine_record\.oid\s*<>\s*'public\.validate_market_integrity\(\)'::pg_catalog\.regprocedure/,
    );
  });

  it("removes only the known policies and closes table and column access", () => {
    const sql = compact(migration());

    for (const [table, policy] of legacyPolicies) {
      expect(sql).toContain(`drop policy ${policy} on public.${table}`);
    }
    for (const table of legacyTables) {
      expect(sql).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(sql).toContain(
        `alter table public.${table} force row level security`,
      );
      expect(sql).toContain(
        `revoke all privileges on table public.${table} from public, anon, authenticated, service_role`,
      );
    }
    expect(sql).toContain("revoke all privileges (");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).not.toMatch(/drop policy if exists/);
    expect(sql).not.toMatch(/\bgrant\b/);
  });

  it("adds PostgreSQL-owned fixed-path ALWAYS row and truncate blockers", () => {
    const sql = compact(migration());
    const functionName = "private.prevent_dormant_demand_mission_mutation()";

    expect(sql).toContain(`create function ${functionName}`);
    expect(sql).toContain("returns trigger language plpgsql security invoker");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain(
      "raise exception 'legacy search, demand, and mission state is dormant' using errcode = '55000'",
    );
    expect(sql).toContain(`alter function ${functionName} owner to postgres`);
    expect(sql).toContain(
      `revoke all on function ${functionName} from public, anon, authenticated, service_role`,
    );

    for (const table of legacyTables) {
      expect(sql).toMatch(
        new RegExp(
          `create trigger ${table}_dormant_rows before insert or update or delete on public\\.${table} for each row execute function private\\.prevent_dormant_demand_mission_mutation\\(\\)`,
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `create trigger ${table}_dormant_truncate before truncate on public\\.${table} for each statement execute function private\\.prevent_dormant_demand_mission_mutation\\(\\)`,
        ),
      );
      expect(sql).toContain(
        `alter table public.${table} enable always trigger ${table}_dormant_rows`,
      );
      expect(sql).toContain(
        `alter table public.${table} enable always trigger ${table}_dormant_truncate`,
      );
    }
  });

  it("ends with exact deny-by-default postconditions", () => {
    const sql = compact(migration());

    expect(sql).toContain("legacy quarantine postcondition failed");
    expect(sql).toContain("relforcerowsecurity");
    expect(sql).toContain("pg_catalog.has_any_column_privilege");
    expect(sql).toContain("aclexplode(attribute_record.attacl)");
    expect(sql).not.toContain("'{}'::pg_catalog.aclitem[]");
    expect(sql).toContain("privilege.grantee = 0");
    expect(sql).toContain("trigger_record.tgenabled = 'a'");
    expect(sql).toContain("trigger_record.tgfoid = blocker_function.oid");
    expect(sql).toContain("trigger_record.tgtype = 31");
    expect(sql).toContain("trigger_record.tgtype = 34");
    expect(sql).toContain("owner_name <> 'postgres'");
    expect(sql).toContain('search_path=""');
  });

  it("is security-only and creates no replacement product surface", () => {
    const sql = compact(migration());

    expect(
      sql.match(
        /create (?:or replace )?function (?:public|private)\.[a-z_][a-z0-9_]*/g,
      ) ?? [],
    ).toEqual([
      "create function private.prevent_dormant_demand_mission_mutation",
    ]);
    expect(sql.match(/\bcreate trigger\b/g) ?? []).toHaveLength(12);
    expect(sql).not.toMatch(/\bcreate table\b/);
    expect(sql).not.toMatch(/\bcreate type\b/);
    expect(sql).not.toMatch(
      /\bcreate (?:materialized view|view|sequence|schema|extension|policy|index)\b/,
    );
    expect(sql).not.toMatch(/\bcreate (?:or replace )?function public\./);
    expect(sql).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|merge\s+into|copy)\s+"?(?:public|private)"?\./,
    );
    expect(sql).not.toMatch(
      /\btruncate\s+(?:table\s+)?"?(?:public|private)"?\./,
    );
    expect(sql).not.toMatch(
      /\b(ai|paystack|reward|commission|payout|ledger|cookie|touchpoint|attribution|consent)\b/,
    );
  });

  it("ships a rollback-only hosted structural and adversarial probe", () => {
    const sql = compact(probe());

    expect(sql).toMatch(/^begin;/);
    expect(sql).toMatch(/rollback;$/);
    expect(sql).toContain("set local lock_timeout");
    expect(sql).toContain("set local statement_timeout");
    expect(sql.indexOf("lock table")).toBeLessThan(sql.indexOf("do $$"));
    expect(sql).toContain("in access exclusive mode");
    expect(sql).toContain("set local role anon");
    expect(sql).toContain("set local role authenticated");
    expect(sql).toContain("set local role service_role");
    expect(sql).toContain("insufficient_privilege");
    expect(sql).toContain(
      "legacy search, demand, and mission state is dormant",
    );
    expect(sql).not.toContain("session_replication_role");
    expect(sql).toContain("insert into auth.users");
    expect(sql).toContain("insert into public.markets");
    for (const table of legacyTables) {
      expect(sql).toContain(`truncate public.${table} cascade`);
      expect(sql).toContain(`select count(*) from public.${table}`);
    }
    expect(sql).toContain("pg_catalog.has_table_privilege");
    expect(sql).toContain("pg_catalog.has_any_column_privilege");
    expect(sql).toContain("aclexplode(attribute_record.attacl)");
    expect(sql).not.toContain("'{}'::pg_catalog.aclitem[]");
    expect(sql).toContain("pg_catalog.pg_policies");
    expect(sql).toContain("relforcerowsecurity");
    expect(sql).toContain("tgenabled = 'a'");
    expect(sql).toContain("'maintain'");
    expect(sql).toContain("trigger_record.tgtype = 31");
    expect(sql).toContain("trigger_record.tgtype = 34");
  });

  it("keeps the older market-integrity probe compatible with quarantine", () => {
    const raw = marketIntegrityProbe();
    const sql = compact(raw);

    expect(raw).toContain("demand_mission_quarantine_probe.sql");
    expect(sql).toContain("expected exactly 12 production");
    const inventory = sql.match(/is distinct from array\[(.*?)\]::text\[\]/);
    expect(inventory?.[1]?.match(/'[^']+'/g) ?? []).toEqual([
      "'businesses'",
      "'categories'",
      "'category_aliases'",
      "'category_listing_type_mappings'",
      "'demand_signals'",
      "'listings'",
      "'market_locations'",
      "'order_items'",
      "'orders'",
      "'requests'",
      "'search_intents'",
      "'unmet_demand'",
    ]);
    for (const table of legacyTables) {
      expect(sql).not.toMatch(
        new RegExp(
          `\\b(?:insert\\s+into|update|delete\\s+from)\\s+public\\.${table}\\b`,
        ),
      );
    }
    for (const behavior of [
      "location parent is invalid",
      "listing business market mismatch",
      "order business market mismatch",
      "order item variant mismatch",
      "validate_market_integrity cannot validate table market_integrity_dispatch_probe",
    ]) {
      expect(sql).toContain(behavior);
    }
  });
});
