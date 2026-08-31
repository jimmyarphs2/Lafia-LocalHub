import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608300017_localhub_listing_customer_requests.sql",
  ),
  "utf8",
);

describe("listing customer request migration contract", () => {
  it("rejects partially linked listing requests even under privileged inserts", () => {
    expect(migration).toContain("requested_action is not null");
    expect(migration).toContain("request_number is not null");
    expect(migration).toContain("search_context is not null");
  });

  it("keeps listing request intent creation service-only and authoritative", () => {
    expect(migration).toContain(
      "create or replace function public.create_listing_request_intent(",
    );
    expect(migration).toContain("p_listing_id uuid,");
    expect(migration).toContain("p_requested_action text,");
    expect(migration).toContain("p_search_context text,");
    expect(migration).not.toContain("p_return_to text");
    expect(migration).not.toContain("p_payload jsonb");
    expect(migration).toContain("l.status = 'active'");
    expect(migration).toContain("l.published_at is not null");
    expect(migration).toContain("b.status = 'active'");
    expect(migration).toContain("m.is_active");
    expect(migration).toContain("c.is_active");
    expect(migration).toContain(
      "route_key := format('%s~%s', target.business_slug, target.listing_slug)",
    );
    expect(migration).toContain(
      "return_path := format('/%s/listings/%s/request', target.market_slug, route_key)",
    );
    expect(migration).toContain("l.id as listing_id");
    expect(migration).not.toMatch(/into target\s*,/);
    expect(migration).toContain(
      "'listing_request_intent' then max_requests := 8",
    );
    expect(migration).toContain(
      "grant execute on function public.create_listing_request_intent(uuid, text, text, text)\n  to service_role",
    );
  });

  it("separates claim from consumption while preserving generic intent handling", () => {
    expect(migration).toContain(
      "add column if not exists claimed_at timestamptz",
    );
    const claim = migration.slice(
      migration.indexOf(
        "create or replace function public.claim_guest_intent(",
      ),
      migration.indexOf(
        "create or replace function public.get_listing_request_intent(",
      ),
    );
    expect(claim).toContain("intent.kind = 'listing_request'");
    expect(claim).toContain("'outcome', 'claimed_by_other'");
    expect(claim).toContain("'outcome', 'replayed'");
    expect(claim).toContain("'outcome', 'expired'");
    expect(claim).toContain("'outcome', 'invalid'");
    expect(claim).toContain("claimed_at = now()");
    expect(claim).toContain(
      "consumed_at = case when intent.kind = 'listing_request' then null else now() end",
    );
    expect(claim).not.toContain("'payload', intent.payload");
  });

  it("materializes exactly one request per claimed intent under row locks", () => {
    expect(migration).toContain("requests_one_request_per_intent_idx");
    const materialize = migration.slice(
      migration.indexOf(
        "create or replace function public.create_listing_request_from_intent(",
      ),
      migration.indexOf(
        "create or replace function public.list_customer_listing_requests(",
      ),
    );
    expect(materialize).toContain("for update;");
    expect(materialize).toContain("for key share of l, b, m, c;");
    expect(materialize).toContain("conflicting listing request replay");
    expect(materialize).toContain("intent.claimed_by is distinct from actor");
    expect(materialize).toContain("set consumed_at = now()");
    expect(materialize).toContain("'replayed'");
    expect(materialize).toContain("'created'");
    expect(materialize).not.toContain("insert into public.orders");
    expect(materialize).not.toContain("insert into public.payments");
  });

  it("uses active-profile customer and selected-business-member read boundaries", () => {
    expect(migration).toContain(
      "revoke insert on public.requests from authenticated",
    );
    expect(migration).toContain("drop policy if exists requests_owner_insert");
    expect(migration).toContain("create policy requests_customer_select");
    expect(migration).toContain(
      "create policy requests_selected_business_member_select",
    );
    expect(migration).toContain("public.is_business_member(business_id)");
    expect(migration).toContain("public.is_current_profile_active()");
    for (const name of [
      "get_listing_request_intent",
      "get_customer_listing_request",
      "list_customer_listing_requests",
      "list_vendor_listing_requests",
    ]) {
      expect(migration).toContain(`grant execute on function public.${name}`);
    }
    expect(migration.match(/vendor_name text/g)?.length).toBeGreaterThanOrEqual(
      4,
    );
    expect(migration).not.toContain("business_name text");
  });

  it("bounds cleanup retention for stale intents and limiter state", () => {
    const cleanup = migration.slice(
      migration.indexOf(
        "create or replace function public.prune_listing_request_intents(",
      ),
      migration.indexOf("revoke insert on public.requests"),
    );
    expect(cleanup).toContain(
      "p_batch_size is null or p_batch_size not between 1 and 2000",
    );
    expect(cleanup).toContain("g.consumed_at is null");
    expect(cleanup).toContain("interval '24 hours'");
    expect(cleanup).toContain("interval '30 days'");
    expect(cleanup).toContain("interval '48 hours'");
    expect(cleanup).toContain("for update skip locked");
    expect(cleanup).toContain("service role is required");
  });
});
