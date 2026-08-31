import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608300021_localhub_order_snapshot_creation.sql",
  ),
  "utf8",
);
const rlsHardening = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608300022_localhub_order_rls_helper_hardening.sql",
  ),
  "utf8",
);
const probe = readFileSync(
  resolve(process.cwd(), "supabase/tests/order_snapshot_creation_probe.sql"),
  "utf8",
);

const between = (start: string, end: string) =>
  migration.slice(migration.indexOf(start), migration.indexOf(end));

describe("protected order snapshot migration contract", () => {
  it("adds a normalized deny-by-default orderability switch without activation", () => {
    expect(migration).toContain(
      "add column if not exists is_orderable boolean not null default false",
    );
    expect(migration).not.toMatch(
      /update\s+public\.listings[\s\S]*is_orderable\s*=\s*true/i,
    );
  });

  it("persists a private, positive, overflow-safe server quote", () => {
    const quote = between(
      "create table private.listing_order_quotes",
      "create or replace function public.consume_auth_rate_limit(",
    );
    expect(quote).toContain(
      "quantity integer not null check (quantity between 1 and 100)",
    );
    expect(quote).toContain("unit_price_minor between 1 and 9007199254740991");
    expect(quote).toContain("total_minor between 1 and 9007199254740991");
    expect(quote).toContain(
      "total_minor::numeric = unit_price_minor::numeric * quantity::numeric",
    );
    expect(quote).toContain(
      "alter table private.listing_order_quotes enable row level security",
    );
    expect(quote).toContain(
      "revoke all on table private.listing_order_quotes\n  from public, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "listing_row.price_minor::numeric * p_quantity::numeric\n      > 9007199254740991::numeric",
    );
    expect(migration).toContain("maxvalue 9999999999");
    expect(migration).not.toContain("order_items_listing_order_quantity_bound");
    expect(migration).toContain(
      "private.is_bounded_visible_order_text(listing_title, 2, 160)",
    );
    expect(migration).toContain(
      "private.is_bounded_visible_order_text(vendor_name, 2, 160)",
    );
    expect(migration).toContain(
      "pg_catalog.char_length(market_slug) between 1 and 80",
    );
    expect(migration).toContain(
      "pg_catalog.char_length(listing_route) between 3 and 201",
    );
    for (const index of [
      "listing_order_quotes_listing_idx",
      "listing_order_quotes_business_idx",
      "listing_order_quotes_market_idx",
      "listing_order_quotes_category_idx",
      "guest_intents_consumed_listing_order_prune_idx",
    ]) {
      expect(migration).toContain(index);
    }
  });

  it("serializes every variant insert and update on the listing parent", () => {
    const serializer = between(
      "create or replace function public.serialize_listing_variant_parent()",
      "create or replace function public.consume_auth_rate_limit(",
    );
    expect(serializer).toContain("security definer");
    expect(serializer).toContain("first_listing_id := new.listing_id");
    expect(serializer).toContain(
      "first_listing_id := least(old.listing_id, new.listing_id)",
    );
    expect(serializer.match(/for update;/g)).toHaveLength(2);
    expect(serializer).toContain(
      "before insert or update on public.listing_variants",
    );
    expect(serializer).not.toContain("before insert or update or delete");
    expect(
      migration.match(/from public\.listings l[\s\S]{0,120}for update;/g),
    ).toHaveLength(4);
  });

  it("keeps every prior limiter scope and isolates bounded order scopes", () => {
    for (const scope of [
      "guest_intent",
      "listing_request_intent",
      "email_sign_in",
      "oauth_sign_in",
      "auth_callback",
      "intent_resume",
      "business_onboarding",
      "business_onboarding_save",
    ]) {
      expect(migration).toContain(`when '${scope}' then`);
    }
    expect(migration).toContain(
      "when 'listing_order_intent' then max_requests := 8; window_seconds := 600",
    );
    expect(migration).toContain(
      "when 'listing_order_place' then max_requests := 20; window_seconds := 3600",
    );
    expect(migration).toContain(
      "when 'listing_order_replay' then max_requests := 120; window_seconds := 3600",
    );
    expect(migration).toContain(
      "public.consume_auth_rate_limit('listing_order_intent', p_rate_limit_key)",
    );
    expect(migration).toContain(
      "public.consume_auth_rate_limit('listing_order_place', actor_rate_key)",
    );
    expect(migration).toContain(
      "public.consume_auth_rate_limit('listing_order_replay', actor_rate_key)",
    );
  });

  it("extends claim-without-consume behavior only to protected request and order kinds", () => {
    const claim = between(
      "create or replace function public.claim_guest_intent(",
      "create or replace function public.create_listing_order_intent(",
    );
    expect(claim).toContain(
      "intent.kind in ('listing_request', 'listing_order')",
    );
    expect(claim).toContain("'outcome', 'claimed_by_other'");
    expect(claim).toContain("'outcome', 'replayed'");
    expect(claim).toContain("'outcome', 'expired'");
    expect(claim).toContain("secret_hash = null");
    expect(claim).toContain("then null\n        else now()");
    expect(claim).toContain("update private.listing_order_quotes");
    expect(claim).not.toContain("'payload', intent.payload");
  });

  it("creates order capabilities from authoritative live base listings only", () => {
    const createIntent = between(
      "create or replace function public.create_listing_order_intent(",
      "create or replace function public.get_listing_order_intent(",
    );
    expect(createIntent).toContain("p_listing_id uuid");
    expect(createIntent).toContain("p_quantity integer");
    expect(createIntent).toContain("p_rate_limit_key text");
    expect(createIntent).not.toContain("p_price");
    expect(createIntent).not.toContain("p_currency");
    expect(createIntent).not.toContain("p_title");
    expect(createIntent).not.toContain("p_business");
    expect(createIntent).toMatch(
      /from public\.listings l[\s\S]{0,120}for update;/,
    );
    expect(createIntent).toContain("for share;");
    expect(createIntent).toContain("listing_row.status <> 'active'");
    expect(createIntent).toContain("listing_row.published_at is null");
    expect(createIntent).toContain("not listing_row.is_orderable");
    expect(createIntent).toContain("listing_row.price_minor <= 0");
    expect(createIntent).toContain("business_row.status <> 'active'");
    expect(createIntent).toContain("not market_row.is_active");
    expect(createIntent).toContain("not category_row.is_active");
    expect(createIntent).toContain(
      "private.is_bounded_visible_order_text(listing_row.title, 2, 160)",
    );
    expect(createIntent).toContain(
      "private.is_bounded_visible_order_text(business_row.name, 2, 160)",
    );
    expect(createIntent).toContain("from public.listing_variants v");
    expect(createIntent).toContain("v.is_active");
    expect(createIntent).toContain("'listing_order'");
    expect(createIntent).toContain("now() + interval '15 minutes'");
    expect(migration).toContain(
      "grant execute on function public.create_listing_order_intent(uuid, integer, text)\n  to service_role",
    );
  });

  it("serializes materialization and creates one immutable authoritative snapshot", () => {
    const materialize = between(
      "create or replace function public.create_listing_order_from_intent(",
      "create or replace function public.list_customer_orders(",
    );
    expect(migration).toContain("orders_one_order_per_guest_intent_idx");
    expect(materialize).toContain("from public.profiles p");
    expect(materialize).toContain("for update;");
    expect(materialize).toMatch(
      /from public\.listings l where l\.id = quote\.listing_id for update;/,
    );
    expect(materialize.match(/for share;/g)?.length).toBeGreaterThanOrEqual(5);
    expect(materialize).toContain("intent.claimed_by is distinct from actor");
    expect(materialize).toContain("intent.expires_at <= now()");
    expect(materialize).toContain("not listing_row.is_orderable");
    expect(materialize).toContain("listing_row.price_minor <= 0");
    expect(materialize).toContain("'quote_changed'");
    expect(materialize).toContain("'unavailable'");
    expect(materialize).toContain("'replayed'");
    expect(materialize).toContain("'created'");
    expect(materialize.match(/insert into public\.orders\(/g)).toHaveLength(1);
    expect(
      materialize.match(/insert into public\.order_items\(/g),
    ).toHaveLength(1);
    expect(
      materialize.match(/insert into public\.order_status_events\(/g),
    ).toHaveLength(1);
    expect(
      materialize.match(/insert into public\.audit_events\(/g),
    ).toHaveLength(1);
    expect(materialize).toContain("'order.placed'");
    expect(materialize).toContain("'listing_order'");
    expect(materialize).toContain("'placed'");
    expect(materialize).toContain("set consumed_at = placement_time");
    expect(materialize).toContain("owned_replay_candidate");
    expect(materialize).toContain(
      "where o.guest_intent_id = p_intent_id and o.buyer_id = actor",
    );
    expect(materialize.indexOf("owned_replay_candidate")).toBeLessThan(
      materialize.indexOf(
        "public.consume_auth_rate_limit('listing_order_place', actor_rate_key)",
      ),
    );
    for (const excluded of [
      "public.payments",
      "public.payment_events",
      "public.fulfilment_events",
      "public.notifications",
      "public.ledger_journals",
      "public.inventory_levels",
    ]) {
      expect(materialize).not.toContain(`insert into ${excluded}`);
    }
    expect(materialize).not.toMatch(
      /status\s*=\s*'(confirmed|cancelled|fulfilled|refunded)'/,
    );
  });

  it("makes the snapshot durable while allowing bounded capability retention cleanup", () => {
    expect(migration).toContain(
      "references public.guest_intents(id) on delete set null",
    );
    expect(migration).toContain("snapshot_source = 'listing_order'");
    expect(migration).toContain("listing order snapshots are immutable");
    expect(migration).toContain(
      "before insert or update or delete on public.order_items",
    );
    expect(migration).toContain(
      "before insert or update or delete on public.order_status_events",
    );
    expect(migration).toContain(
      "select 1 from public.order_items i where i.order_id = new.order_id",
    );
    expect(migration).toContain(
      "select 1 from public.order_status_events e where e.order_id = new.order_id",
    );
    expect(migration).toContain("orders_protect_listing_order_snapshot");
    expect(migration).toContain("order_items_protect_listing_order_snapshot");
    expect(migration).toContain("order_events_protect_listing_order_snapshot");
    const cleanup = between(
      "create or replace function public.prune_listing_order_intents(",
      "-- Active profile state",
    );
    expect(cleanup).toContain("p_batch_size not between 1 and 2000");
    expect(cleanup).toContain("interval '24 hours'");
    expect(cleanup).toContain("interval '30 days'");
    expect(cleanup).toContain("interval '48 hours'");
    expect(cleanup).toContain("for update skip locked");
    expect(cleanup).toContain("service role is required");
  });

  it("exposes bounded active-profile customer and exact-membership vendor projections", () => {
    for (const name of [
      "get_listing_order_intent",
      "list_customer_orders",
      "get_customer_order",
      "list_vendor_orders",
      "get_vendor_order",
    ]) {
      expect(migration).toContain(`grant execute on function public.${name}`);
    }
    expect(migration.match(/limit 100/g)?.length).toBeGreaterThanOrEqual(2);
    expect(
      migration.match(/public\.is_current_profile_active\(\)/g)?.length,
    ).toBeGreaterThanOrEqual(7);
    expect(migration).toContain("membership.business_id = o.business_id");
    expect(migration).toContain("membership.accepted_at is not null");
    expect(
      migration.match(/extra\.order_id = o\.id and extra\.id <> i\.id/g),
    ).toHaveLength(4);
    expect(migration).not.toMatch(
      /returns table\([\s\S]{0,500}(buyer_id|email|phone_e164)/,
    );
  });

  it("keeps authenticated Realtime reads but revokes every direct mutation route", () => {
    expect(migration).toContain(
      "revoke all on table public.orders, public.order_items, public.order_status_events\n  from public, anon, authenticated, service_role",
    );
    expect(migration).toContain("orders_active_customer_or_vendor_select");
    expect(migration).toContain("order_items_active_customer_or_vendor_select");
    expect(migration).toContain(
      "order_events_active_customer_or_vendor_select",
    );
    expect(migration).toContain("on public.orders to authenticated");
    expect(rlsHardening).toContain(
      "grant usage on schema private to authenticated",
    );
    expect(rlsHardening).toContain(
      "grant execute on function private.can_current_actor_view_order(uuid)\n  to authenticated",
    );
    expect(rlsHardening).toContain(
      "using ((select private.can_current_actor_view_order(order_items.order_id)))",
    );
    expect(rlsHardening).toContain(
      "using ((select private.can_current_actor_view_order(order_status_events.order_id)))",
    );
    expect(rlsHardening).toContain(
      "drop function public.can_current_actor_view_order(uuid)",
    );
    expect(rlsHardening).not.toContain(
      "grant execute on function public.can_current_actor_view_order",
    );
    expect(migration).not.toMatch(
      /grant\s+(insert|update|delete)[\s\S]*public\.(orders|order_items|order_status_events)/i,
    );
    expect(migration).not.toMatch(/grant select \([\s\S]{0,300}\bbuyer_id\b/);
    expect(migration).not.toMatch(/grant select \([\s\S]{0,300}\bactor_id\b/);
  });

  it("ships a rigorous rollback-only live probe with no secret output", () => {
    expect(
      probe.trimStart().startsWith("-- Rollback-only live regression probe"),
    ).toBe(true);
    expect(probe).toMatch(/\nbegin;\n/);
    expect(probe.trimEnd().endsWith("rollback;")).toBe(true);
    for (const fixture of [
      "nonorderable_listing_id",
      "unpublished_listing_id",
      "unpriced_listing_id",
      "paused_listing_id",
      "foreign_listing_id",
      "suspended_id",
    ]) {
      expect(probe).toContain(fixture);
    }
    expect(probe).toContain("'claimed_by_other'");
    expect(probe).toContain("'quote_changed'");
    expect(probe).toContain("'replayed'");
    expect(probe).toContain("rate limiting overrode an idempotent replay");
    expect(probe).toContain("for attempt in 1..120 loop");
    expect(probe).toContain("replay limiter exceeded its exact budget");
    expect(probe).toContain("second order item unexpectedly succeeded");
    expect(probe).toContain("second placed event unexpectedly succeeded");
    expect(probe).toContain("guest_intent_id is null");
    expect(probe).toContain("listing order snapshots are immutable");
    expect(probe).toContain("U&'\\034F\\034F'");
    expect(probe).toContain("repeat('a', 81)");
    expect(probe).toContain("order-probe-invisible-title");
    expect(probe).toContain("order-probe-invisible-vendor");
    expect(probe).toContain("order-probe-overlong-market");
    expect(probe).toContain(
      "from public.order_items where order_id = state.order_id",
    );
    expect(probe).toContain(
      "from public.order_status_events\n        where order_id = state.order_id",
    );
    expect(probe).toContain("baseline_payments");
    expect(probe).toContain("baseline_fulfilment");
    expect(probe).toContain("baseline_notifications");
    expect(probe).not.toMatch(
      /select\s+(intent_secret|changed_intent_secret)\s+from/i,
    );
    expect(probe).not.toMatch(/raise\s+(notice|warning)[^;]*secret/i);
  });
});
