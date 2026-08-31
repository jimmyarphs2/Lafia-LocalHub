import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function migration026() {
  const directory = resolve(process.cwd(), "supabase", "migrations");
  const name = readdirSync(directory).find((entry) =>
    /^202608300026_.*\.sql$/.test(entry),
  );
  if (!name) throw new Error("Missing Step 22 migration 202608300026_*.sql");
  return readFileSync(resolve(directory, name), "utf8");
}

function functionSection(sql: string, name: string) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  expect(start, `missing public.${name}`).toBeGreaterThanOrEqual(0);
  const next = sql.indexOf("\ncreate or replace function public.", start + 1);
  return sql.slice(start, next < 0 ? undefined : next);
}

describe("super-admin pending-business triage migration contract", () => {
  it("repairs the strict onboarding validator with PostgreSQL-supported key counting", () => {
    const migration = migration026();
    const validator = functionSection(
      migration,
      "is_valid_completed_onboarding_draft",
    );

    expect(validator).toContain("security definer");
    expect(validator).toContain("set search_path = ''");
    expect(validator).toMatch(
      /count\(\*\) from pg_catalog\.jsonb_object_keys\(draft_data\)/i,
    );
    expect(validator).toMatch(
      /count\(\*\) from pg_catalog\.jsonb_object_keys\(payload\)/i,
    );
    expect(validator).not.toContain("jsonb_object_length");
    expect(migration.replace(/\s+/g, "").toLowerCase()).toContain(
      "revokeallonfunctionpublic.is_valid_completed_onboarding_draft(uuid,jsonb)frompublic,anon,authenticated,service_role;",
    );
  });

  it("exposes only the bounded, authenticated super-admin read RPC", () => {
    const migration = migration026();
    const rpc = functionSection(
      migration,
      "list_super_admin_pending_businesses",
    );

    expect(rpc).toContain("p_market_id uuid");
    expect(rpc).toContain("p_after_submitted_at timestamptz default null");
    expect(rpc).toContain("p_after_business_id uuid default null");
    expect(rpc).toContain("p_limit integer default 25");
    expect(rpc).toContain("security definer");
    expect(rpc).toContain("set search_path = ''");
    expect(rpc).toContain("auth.role()) is distinct from 'authenticated'");
    expect(rpc).toContain("actor uuid := (select auth.uid())");
    expect(rpc).toContain("public.is_current_profile_active()");
    expect(rpc).toContain("public.has_capability('super_admin')");
    expect(rpc).not.toContain("public.has_capability('admin')");
    expect(rpc).toMatch(/p_limit\s+not\s+between\s+1\s+and\s+50/i);
    expect(rpc).toContain("limit p_limit + 1");
    expect(rpc).toContain("business_id uuid");
    expect(rpc).toContain("business_name text");
    expect(rpc).toContain("market_id uuid");
    expect(rpc).toContain("market_slug text");
    expect(rpc).toContain("market_name text");
    expect(rpc).toContain("category_slug text");
    expect(rpc).toContain("submitted_at timestamptz");
    expect(rpc).toContain("has_more boolean");
  });

  it("filters to submitted pending businesses in the exact active market and excludes an accepted own membership", () => {
    const rpc = functionSection(
      migration026(),
      "list_super_admin_pending_businesses",
    );

    expect(rpc).toContain("business.status = 'pending_review'");
    expect(rpc).toContain("business.market_id = p_market_id");
    expect(rpc).toContain("market.is_active");
    expect(rpc).toContain("draft.submitted_at is not null");
    expect(rpc).toContain(
      "public.is_valid_completed_onboarding_draft(business.id, draft.data)",
    );
    expect(rpc).toContain("membership.business_id = business.id");
    expect(rpc).toContain("membership.profile_id = actor");
    expect(rpc).toContain("membership.accepted_at is not null");
  });

  it("uses one ascending submitted-at/business-id keyset order and returns a consistent has-more bit", () => {
    const rpc = functionSection(
      migration026(),
      "list_super_admin_pending_businesses",
    );

    expect(rpc).toMatch(
      /order by\s+(?:draft\.|page\.|eligible\.)?submitted_at\s*(?:asc)?\s*,\s*(?:business\.|page\.|eligible\.)?business_id\s*(?:asc)?/i,
    );
    expect(rpc).toMatch(
      /\(draft\.submitted_at, business\.id\)\s*>\s*\(p_after_submitted_at, p_after_business_id\)/i,
    );
    expect(rpc).toMatch(
      /\(p_after_submitted_at is null\)\s*(?:<>|is distinct from)\s*\(p_after_business_id is null\)/i,
    );
    expect(rpc).toMatch(/count\(\*\)\s+from eligible\)\s*>\s*p_limit/i);
    expect(rpc).not.toMatch(/\boffset\b/i);
  });

  it("keeps the wire projection PII-minimized and forbids raw-row projection", () => {
    const rpc = functionSection(
      migration026(),
      "list_super_admin_pending_businesses",
    );
    const compact = rpc.replace(/\s+/g, " ").toLowerCase();

    expect(compact).not.toMatch(/select\s+business\.\*/);
    expect(compact).not.toMatch(/select\s+\*/);
    for (const forbidden of [
      "legal_name",
      "address_text",
      "phone_e164",
      "metadata",
      "display_name",
      "avatar_path",
      "email",
      "owner_id",
    ]) {
      expect(
        rpc,
        `unsafe triage projection includes ${forbidden}`,
      ).not.toContain(forbidden);
    }
  });

  it("removes legacy business-status execution and makes admin events immutable to all app roles", () => {
    const migration = migration026();
    const compact = migration.replace(/\s+/g, "").toLowerCase();

    expect(compact).toContain(
      "revokeexecuteonfunctionpublic.transition_business_status(uuid,text,text)frompublic,anon,authenticated,service_role;",
    );
    expect(compact).toContain(
      "revokeexecuteonfunctionpublic.set_profile_suspension(uuid,boolean,text)fromservice_role;",
    );
    expect(compact).toContain(
      "revokeinsert,update,delete,truncateontablepublic.admin_eventsfrompublic,anon,authenticated,service_role;",
    );
    expect(migration).toMatch(
      /create trigger [a-z_]+[\s\S]*before update or delete or truncate on public\.admin_events[\s\S]*for each statement/i,
    );
    expect(migration).toMatch(/raise exception ['"].*immutable/i);
    expect(compact).not.toContain(
      "grantexecuteonfunctionpublic.transition_business_status(uuid,text,text)toauthenticated",
    );
  });
});
