import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function migration() {
  const directory = resolve(process.cwd(), "supabase", "migrations");
  const name = readdirSync(directory).find((entry) =>
    /^202608310031_.*\.sql$/.test(entry),
  );
  if (!name) throw new Error("Missing Step 25A1 migration 202608310031_*.sql");
  return readFileSync(resolve(directory, name), "utf8");
}

function probe() {
  return readFileSync(
    resolve(
      process.cwd(),
      "supabase",
      "tests",
      "referral_acquisition_links_probe.sql",
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

describe("referral acquisition links migration contract", () => {
  it("locks and quarantines all legacy referral state before changes", () => {
    const sql = compact(migration());
    const lock = sql.indexOf("lock table");
    const check = sql.indexOf("do $$");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(check);
    expect(sql.slice(lock, check)).toContain("in share row exclusive mode");
    for (const table of [
      "referral_rules",
      "referral_codes",
      "referral_attributions",
      "referral_commissions",
    ]) {
      expect(sql).toContain(`public.${table}`);
      expect(sql).toContain(`exists (select 1 from public.${table})`);
      expect(sql).toMatch(
        new RegExp(`before insert or update or delete on public\\.${table}`),
      );
      expect(sql).toMatch(new RegExp(`before truncate on public\\.${table}`));
    }
    expect(sql).toContain(
      "drop policy if exists referral_codes_owner on public.referral_codes",
    );
    expect(sql).toContain("prevent_dormant_referral_legacy_mutation");
    expect(sql).toContain(
      "referral acquisition migration requires no legacy column acl drift",
    );
  });

  it("creates only typed identity and opaque acquisition link primitives", () => {
    const sql = compact(migration());
    for (const [type, labels] of [
      ["referrer_status_code", "active', 'disabled"],
      ["referral_link_status_code", "active', 'disabled', 'expired"],
      ["referral_target_code", "merchant_onboarding"],
    ]) {
      expect(sql).toContain(`create type private.${type} as enum`);
      expect(sql).toContain(labels);
      expect(sql).toContain(
        `revoke all on type private.${type} from public, anon, authenticated, service_role`,
      );
    }
    expect(sql).toContain("create table private.referrer_identities");
    expect(sql).toContain("create table private.referral_acquisition_links");
    expect(sql).toContain(
      "code text not null unique check (code ~ '^[0-9a-f]{32}$')",
    );
    expect(sql).toContain(
      "unique (referrer_profile_id, market_id, target, generation_version)",
    );
    expect(sql).toContain(
      "referrer_profile_id uuid not null references private.referrer_identities(profile_id) on delete restrict",
    );
    expect(sql).not.toContain("referrer_status private.referrer_status_code");
    expect(sql).not.toContain("(referrer_profile_id, referrer_status)");
    expect(sql).toContain("where status = 'active'");
    expect(sql).toContain("on delete restrict");
    expect(sql).not.toMatch(
      /create table private\.[^(]*(balance|reward|commission|payment|kyc|bank|email|phone)/,
    );
  });

  it("uses only narrow hardened public RPC wrappers with precise execute grants", () => {
    const sql = compact(migration());
    for (const name of [
      "ensure_my_referrer_identity()",
      "create_or_get_my_referral_link(p_market_id uuid)",
      "list_my_referral_links()",
      "set_my_referral_link_enabled(p_link_id uuid, p_enabled boolean)",
      "resolve_referral_acquisition_link(p_code text)",
    ]) {
      expect(sql).toContain(`create or replace function public.${name}`);
    }
    expect(
      sql.match(/create or replace function public\./g) ?? [],
    ).toHaveLength(5);
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("extensions.gen_random_bytes(16)");
    expect(sql).toContain("encode(");
    expect(sql).toContain(
      "on conflict on constraint referrer_identities_pkey do nothing",
    );
    expect(sql).toContain(
      "if p_link_id is null or p_enabled is null then raise exception 'invalid referral link change' using errcode='22023'",
    );
    expect(sql).toContain(
      "case when p_enabled then 'active'::private.referral_link_status_code else 'disabled'::private.referral_link_status_code end",
    );
    expect(sql).toContain("l.status in ('active','expired')");
    expect(sql).toContain("when l.status='expired'");
    expect(sql.indexOf("octet_length(p_code) <> 32")).toBeLessThan(
      sql.indexOf("p_code !~ '^[0-9a-f]{32}$'"),
    );
    for (const signature of [
      "private.prevent_dormant_referral_legacy_mutation()",
      "public.ensure_my_referrer_identity()",
      "public.create_or_get_my_referral_link(uuid)",
      "public.list_my_referral_links()",
      "public.set_my_referral_link_enabled(uuid, boolean)",
      "public.resolve_referral_acquisition_link(text)",
    ]) {
      expect(sql).toContain(`alter function ${signature} owner to postgres`);
    }
    expect(sql).toContain(
      "grant execute on function public.ensure_my_referrer_identity() to authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.resolve_referral_acquisition_link(text) to anon, authenticated",
    );
    expect(sql).not.toMatch(/grant execute[^;]+service_role/);
  });

  it("keeps direct relations deny-by-default and ships a rollback-only probe", () => {
    const sql = compact(migration());
    for (const table of ["referrer_identities", "referral_acquisition_links"]) {
      expect(sql).toContain(
        `alter table private.${table} enable row level security`,
      );
      expect(sql).toContain(
        `alter table private.${table} force row level security`,
      );
      expect(sql).toContain(
        `revoke all on table private.${table} from public, anon, authenticated, service_role`,
      );
    }
    const check = compact(probe());
    expect(check).toMatch(/^begin;/);
    expect(check).toMatch(/rollback;$/);
    expect(check).toContain(
      "from public.create_or_get_my_referral_link(state.active_market)",
    );
    expect(check).toContain(
      "from public.set_my_referral_link_enabled(created.link_id, null)",
    );
    expect(check).toContain("set status = 'disabled', disabled_at = now()");
    expect(check).toContain("set status = 'expired'");
    expect(check).toContain("set is_active = false");
    expect(check).toContain("set is_suspended = true");
    expect(check).toContain(
      "cross-user referral link update unexpectedly worked",
    );
    expect(check).toContain("pg_catalog.has_function_privilege(");
    expect(check).toContain("private.commerce_ledger_posting_pairs");
    expect(check).toContain(
      "execute pg_catalog.format('truncate table %s cascade', table_name)",
    );
  });

  it("does not activate attribution, tracking, finance, or legacy referral writes", () => {
    const sql = compact(migration());
    expect(sql).not.toMatch(
      /insert into public\.referral_|update public\.referral_|delete from public\.referral_/,
    );
    expect(sql).not.toMatch(
      /create table private\.(?:.*(?:attribution|commission|payment|payout|ledger))/,
    );
    expect(sql).not.toMatch(
      /\b(cookie|consent|touchpoint|percentage|duration)\b/,
    );
  });
});
