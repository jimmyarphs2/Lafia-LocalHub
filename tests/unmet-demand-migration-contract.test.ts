import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
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

const migrationPath =
  "supabase/migrations/202608310037_localhub_unmet_demand_capture.sql";
const probePath = "supabase/tests/unmet_demand_capture_probe.sql";

describe("privacy-bounded unmet-demand migration", () => {
  it("refuses partial installation or drift in the quarantined and dormant foundations", () => {
    const sql = compact(read(migrationPath));

    expect(sql).toContain("set local lock_timeout = '10s'");
    expect(sql).toContain("set local statement_timeout = '120s'");
    for (const relation of [
      "public.searches",
      "public.search_intents",
      "public.demand_signals",
      "public.unmet_demand",
      "public.missions",
      "public.mission_progress",
      "private.demand_gap_definitions",
      "private.referral_mission_definitions",
    ]) {
      expect(sql).toContain(relation);
      expect(sql).toContain(`exists (select 1 from ${relation})`);
    }
    expect(sql).toContain("no partial unmet-demand capture objects");
    expect(sql).toContain("using errcode = '55000'");
  });

  it("stores only one private market/category/day marker without identity or free text", () => {
    const sql = compact(read(migrationPath));
    const tableDefinition = sql.match(
      /create table private\.unmet_demand_zero_result_days \(([\s\S]*?)\);/,
    )?.[1];

    expect(sql).toContain("create table private.unmet_demand_zero_result_days");
    expect(sql).toContain("market_id uuid not null");
    expect(sql).toContain("category_id uuid not null");
    expect(sql).toContain("observed_on date not null");
    expect(sql).toContain("created_at timestamptz not null");
    expect(sql).toContain("primary key (market_id, category_id, observed_on)");
    expect(tableDefinition).toBeTruthy();
    expect(tableDefinition).not.toMatch(
      /\b(query|payload|profile_id|user_id|email|phone|ip_address|device|intent_id|referral|mission|reward|commission|payment|ledger|payout|provider|ai_)\b/,
    );
  });

  it("exposes one authenticated-only, fixed-input, non-oracular writer", () => {
    const sql = compact(read(migrationPath));

    expect(sql).toContain(
      "create function public.record_my_unmet_demand_zero_result(p_market_slug text, p_category_id uuid)",
    );
    expect(sql).toContain("returns boolean");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("owner to postgres");
    expect(sql).toContain(
      "revoke all on function public.record_my_unmet_demand_zero_result(text, uuid) from public, anon, authenticated, service_role",
    );
    expect(sql).toContain(
      "grant execute on function public.record_my_unmet_demand_zero_result(text, uuid) to authenticated",
    );
    expect(sql).not.toContain(
      "grant execute on function public.record_my_unmet_demand_zero_result(text, uuid) to service_role",
    );
  });

  it("revalidates active actor, canonical category, and zero public supply", () => {
    const sql = compact(read(migrationPath));

    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("public.profiles");
    expect(sql).toContain("not profile_record.is_suspended");
    expect(sql).toContain("public.markets");
    expect(sql).toContain("market_record.is_active");
    expect(sql).toContain("public.categories");
    expect(sql).toContain("category_record.is_active");
    expect(sql).toContain("category_record.market_id is null");
    expect(sql).toContain("public.listings");
    expect(sql).toContain("public.businesses");
    expect(sql).toContain("listing_record.status = 'active'");
    expect(sql).toContain("listing_record.published_at is not null");
    expect(sql).toContain("business_record.status = 'active'");
    expect(sql).toContain("pg_catalog.pg_timezone_names");
    expect(sql).toContain("as materialized");
  });

  it("is atomic, idempotent, forced-RLS, ACL-closed, immutable, and absent from Realtime", () => {
    const sql = compact(read(migrationPath));

    expect(sql).toContain(
      "on conflict (market_id, category_id, observed_on) do nothing",
    );
    expect(sql).toContain(
      "alter table private.unmet_demand_zero_result_days enable row level security",
    );
    expect(sql).toContain(
      "alter table private.unmet_demand_zero_result_days force row level security",
    );
    expect(sql).toContain(
      "revoke all on table private.unmet_demand_zero_result_days from public, anon, authenticated, service_role",
    );
    expect(sql).toContain("enable always trigger");
    expect(sql).toContain("unmet-demand capture postcondition failed");
    expect(sql).toContain("pg_catalog.pg_publication_tables");
  });

  it("does not activate legacy demand, definitions, missions, economics, providers, or AI", () => {
    const sql = compact(read(migrationPath));
    const createStatements =
      sql.match(/create (?:table|view|function|trigger) [^ ]+/g) ?? [];

    expect(createStatements.join(" ")).not.toMatch(
      /public\.(searches|search_intents|demand_signals|unmet_demand|missions|mission_progress)/,
    );
    expect(sql).not.toMatch(
      /insert into private\.(demand_gap_definitions|referral_mission_definitions)/,
    );
    expect(createStatements.join(" ")).not.toMatch(
      /\b(referral|mission|reward|commission|payment|ledger|payout|provider|openai|artificial intelligence)\b/,
    );
  });

  it("ships a rollback-only behavioral probe without shared-sequence rewinds", () => {
    const sql = compact(read(probePath));

    expect(sql).toMatch(/^begin;/);
    expect(sql).toMatch(/rollback;$/);
    expect(sql).not.toContain("pg_catalog.setval");
    expect(sql).toContain("errcode = '55000'");
    expect(sql).toContain("rejected demand request left an observation");
    for (const evidence of [
      "anonymous rpc execution unexpectedly succeeded",
      "service-role rpc execution unexpectedly succeeded",
      "direct table access unexpectedly succeeded",
      "suspended actor unexpectedly recorded demand",
      "foreign category unexpectedly recorded demand",
      "supplied category unexpectedly recorded demand",
      "first demand observation was not accepted",
      "demand observation replay was not accepted",
      "demand observation replay created more than one row",
      "legacy demand quarantine drifted",
      "dormant demand definition foundation drifted",
      "left unmet-demand probe fixture residue",
    ]) {
      expect(sql).toContain(evidence);
    }
  });
});
