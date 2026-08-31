import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608300023_localhub_order_vendor_transitions.sql",
  ),
  "utf8",
);
const contract = readFileSync(
  resolve(process.cwd(), "docs/LOCALHUB_ORDER_VENDOR_TRANSITION_CONTRACT.md"),
  "utf8",
);
const probe = readFileSync(
  resolve(process.cwd(), "supabase/tests/vendor_order_transition_probe.sql"),
  "utf8",
);

const section = (start: string, end?: string) => {
  const startAt = migration.indexOf(start);
  expect(startAt, `missing migration section: ${start}`).toBeGreaterThanOrEqual(
    0,
  );
  const endAt = end ? migration.indexOf(end, startAt + start.length) : -1;
  return migration.slice(startAt, endAt < 0 ? undefined : endAt);
};

describe("protected vendor order transition migration contract", () => {
  it("defines one canonical vendor timestamp and the three-state snapshot shape", () => {
    expect(migration).toContain(
      "add column if not exists vendor_decided_at timestamptz",
    );
    expect(migration).toContain(
      "status in ('placed', 'confirmed', 'cancelled')",
    );
    expect(migration).toContain(
      "status = 'placed' and vendor_decided_at is null",
    );
    expect(migration).toContain(
      "status in ('confirmed', 'cancelled')\n          and vendor_decided_at is not null",
    );
    expect(migration).toContain("vendor_decided_at >= placed_at");
    expect(migration).toContain("orders_listing_order_snapshot_shape");
    expect(contract).toContain("placed -> confirmed");
    expect(contract).toContain("placed -> cancelled");
  });

  it("keeps the transition ledger and limiter private, RLS-protected, and ungranted", () => {
    for (const table of [
      "private.listing_order_vendor_transitions",
      "private.listing_order_vendor_transition_rate_limits",
    ]) {
      expect(migration).toContain(`create table ${table}`);
      expect(migration).toMatch(
        new RegExp(
          `alter table ${table.replaceAll(".", "\\.")}\\s+enable row level security`,
          "i",
        ),
      );
      expect(migration).toContain(
        `revoke all on table ${table}\n  from public, anon, authenticated, service_role`,
      );
    }
    expect(migration).toContain("primary key (actor_id, idempotency_key)");
    expect(migration).toContain("unique (order_id)");
    expect(migration).toContain("request_count integer not null default 0");
    expect(migration).toContain("check (request_count between 0 and 121)");
    expect(migration).toContain("return current_count <= 120;");
  });

  it("validates exact decisions, UUIDv4 keys, and durable outcome semantics", () => {
    const core = section(
      "create or replace function private.respond_to_listing_order(",
      "create or replace function public.respond_to_listing_order(",
    );
    expect(migration).toContain(
      "decision text not null check (decision in ('confirm', 'cancel'))",
    );
    expect(migration).toContain("result_status in ('confirmed', 'cancelled')");
    expect(core).toContain("p_decision not in ('confirm', 'cancel')");
    expect(core).toContain("!~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab]");
    for (const outcome of [
      "'transitioned'",
      "'replayed'",
      "'already_transitioned'",
      "'conflict'",
      "'not_found'",
      "'idempotency_key_reused'",
    ]) {
      expect(core).toContain(outcome);
    }
    expect(core).toContain("retryable");
    expect(core).toContain("return query select null::uuid, 'invalid'");
  });

  it("requires an active profile, active business, and accepted exact-business vendor role", () => {
    const core = section(
      "create or replace function private.respond_to_listing_order(",
      "create or replace function public.respond_to_listing_order(",
    );
    expect(core).toContain("profile.id = actor and not profile.is_suspended");
    expect(core).toContain("business.id = order_row.business_id");
    expect(core).toContain("business.status = 'active'");
    expect(core).toContain("membership.business_id = order_row.business_id");
    expect(core).toContain("membership.profile_id = actor");
    expect(core).toContain("membership.accepted_at is not null");
    expect(core).toContain("membership.role in ('owner', 'manager', 'staff')");
    expect(core).toContain("return query select null::uuid, 'not_found'");
  });

  it("proves actor-first rate limiting and deterministic lock order before attacker order lookup", () => {
    const wrapper = section(
      "create or replace function public.respond_to_listing_order(",
      "-- Preserve placement replay",
    );
    const core = section(
      "create or replace function private.respond_to_listing_order(",
      "create or replace function public.respond_to_listing_order(",
    );
    expect(
      wrapper.indexOf("from public.profiles profile"),
    ).toBeGreaterThanOrEqual(0);
    expect(
      wrapper.indexOf(
        "private.consume_listing_order_vendor_transition_rate_limit",
      ),
    ).toBeGreaterThanOrEqual(0);
    expect(
      wrapper.indexOf(
        "private.consume_listing_order_vendor_transition_rate_limit",
      ),
    ).toBeLessThan(wrapper.indexOf("private.respond_to_listing_order"));
    expect(core).toContain("pg_advisory_xact_lock");
    expect(core).toContain("listing_order_vendor_transition:'");
    expect(core).toContain("for share;");
    expect(core).toContain("for no key update;");
    expect(
      core.indexOf("from private.listing_order_vendor_transitions"),
    ).toBeLessThan(core.indexOf("from public.orders orders"));
  });

  it("gates exactly placed-to-terminal mutation and appends one matching event, ledger row, and minimized audit", () => {
    const trigger = section(
      "create or replace function public.prevent_listing_order_snapshot_mutation(",
      "create or replace function private.consume_listing_order_vendor_transition_rate_limit(",
    );
    const core = section(
      "create or replace function private.respond_to_listing_order(",
      "create or replace function public.respond_to_listing_order(",
    );
    expect(trigger).toContain("old.status = 'placed'");
    expect(trigger).toContain("old.vendor_decided_at is null");
    expect(trigger).toContain("new.status::text = transition_status");
    expect(trigger).toContain(
      "new.vendor_decided_at = transition_at::timestamptz",
    );
    expect(trigger).toContain("'status', 'vendor_decided_at', 'updated_at'");
    expect(trigger).toContain("listing order snapshots are immutable");
    expect(migration).toMatch(
      /create or replace function (?:private|public)\.set_order_updated_at\(\)/,
    );
    expect(migration).toContain("create trigger orders_set_updated_at");
    expect(migration).toMatch(
      /execute function (?:private|public)\.set_order_updated_at\(\)/,
    );
    expect(migration).toContain("new.updated_at := transition_at::timestamptz");
    expect(migration).toContain("new.updated_at := old.updated_at");
    expect(core.match(/update public\.orders orders/g)).toHaveLength(1);
    expect(core).toContain("set status = target_status::public.order_status,");
    expect(core).toContain("vendor_decided_at = transition_time");
    expect(core).toContain("insert into public.order_status_events(");
    expect(core).toContain(
      "insert into private.listing_order_vendor_transitions(",
    );
    expect(core).toContain("insert into public.audit_events(");
    expect(core).toContain("'from_status', 'placed'");
    expect(core).toContain("'to_status', target_status");
    expect(core).toContain("transition_time");
    for (const excluded of [
      "public.payments",
      "public.payment_events",
      "public.fulfilment_events",
      "public.inventory_levels",
      "public.notifications",
      "public.ledger_journals",
      "public.ledger_entries",
    ]) {
      expect(core).not.toContain(`insert into ${excluded}`);
    }
  });

  it("keeps immutable item/event histories and permits only the durable terminal placement replay chain", () => {
    const trigger = section(
      "create or replace function public.prevent_listing_order_snapshot_mutation(",
      "create or replace function private.consume_listing_order_vendor_transition_rate_limit(",
    );
    expect(trigger).toContain("elsif tg_table_name = 'order_items'");
    expect(trigger).toContain("elsif tg_table_name = 'order_status_events'");
    expect(migration).toContain("private.is_consistent_placed_listing_order");
    expect(migration).toContain("private.is_consistent_terminal_listing_order");
    expect(migration).toContain("select count(*)");
    expect(migration).toContain(") = 1");
    expect(migration).toContain(") = 2");
    const replay = section(
      "create function public.create_listing_order_from_intent(",
      "-- PostgreSQL cannot change a RETURNS TABLE shape",
    );
    expect(replay).toContain("status in ('confirmed', 'cancelled')");
    expect(replay).toContain("'replayed'");
    expect(replay).toContain("private.is_consistent_terminal_listing_order(");
    expect(replay).toContain(
      "listing order terminal replay state is inconsistent",
    );
    expect(replay).toContain("intent.consumed_at is null");
    expect(replay).toContain("existing_order.vendor_decided_at");
    expect(
      replay.match(
        /select \* from private\.forward_listing_order_placement\(p_intent_id\)/g,
      ),
    ).toHaveLength(3);
    expect(migration).toContain(
      "create function private.forward_listing_order_placement(",
    );
    expect(migration).toContain("select * into strict placement");
    expect(migration).toContain(
      "not private.is_consistent_placed_listing_order(placement.order_id)",
    );
    expect(migration).toContain(
      "placement.created_at, placement.placed_at, null::timestamptz",
    );
    expect(replay).toContain(
      "existing_order.placed_at, existing_order.vendor_decided_at",
    );
    expect(replay).not.toContain("insert into public.orders(");
    expect(replay).not.toContain("insert into public.order_items(");
  });

  it("bounds cleanup with service-role authorization and SKIP LOCKED batches", () => {
    const cleanup = section(
      "create or replace function public.prune_listing_order_vendor_transitions(",
    );
    expect(cleanup).toContain("p_batch_size not between 1 and 2000");
    expect(cleanup).toContain("service role is required");
    expect(cleanup).toContain("interval '30 days'");
    expect(cleanup).toContain("interval '48 hours'");
    expect(cleanup.match(/for update skip locked/g)).toHaveLength(2);
    expect(cleanup.match(/limit p_batch_size/g)).toHaveLength(2);
    expect(migration).toContain(
      "grant execute on function public.prune_listing_order_vendor_transitions(integer)",
    );
  });

  it("reasserts safe projections and direct-mutation grants", () => {
    for (const projection of [
      "list_customer_orders",
      "get_customer_order",
      "list_vendor_orders",
      "get_vendor_order",
    ]) {
      expect(migration).toContain(`create function public.${projection}`);
      expect(migration).toContain(
        `grant execute on function public.${projection}`,
      );
    }
    expect(
      migration.match(/vendor_decided_at timestamptz/g)?.length,
    ).toBeGreaterThanOrEqual(5);
    expect(migration).toContain("limit 100");
    expect(migration).toContain("membership.accepted_at is not null");
    expect(migration).toContain(
      "revoke all on table public.orders, public.order_items,",
    );
    expect(migration).toContain(
      "grant select (\n  id, order_number, business_id, market_id, status",
    );
    expect(migration).toContain(
      "grant select (id, order_id, status, occurred_at)",
    );
    expect(migration).not.toMatch(
      /grant\s+(insert|update|delete)[\s\S]*public\.(orders|order_items|order_status_events)/i,
    );
    for (const projection of [
      "list_customer_orders",
      "get_customer_order",
      "list_vendor_orders",
      "get_vendor_order",
    ]) {
      const start = migration.indexOf(`create function public.${projection}`);
      const signature = migration.slice(
        start,
        migration.indexOf("language", start),
      );
      expect(signature).not.toMatch(
        /\b(buyer_id|phone_e164|email|secret_hash|actor_id)\b/,
      );
    }
  });

  it("contains explicit proof of both terminal orders, denial, replay, projections, and rollback boundaries", () => {
    expect(
      probe.trimStart().startsWith("-- Rollback-only live regression probe"),
    ).toBe(true);
    expect(probe.trimEnd().endsWith("rollback;")).toBe(true);
    expect(probe).toMatch(/\nbegin;\n/);
    for (const token of [
      "confirm_order_id",
      "cancel_order_id",
      "staff_order_id",
      "owner",
      "manager",
      "staff",
      "pending",
      "foreign",
      "suspended",
      "inactive",
      "already_transitioned",
      "conflict",
      "idempotency_key_reused",
      "terminal placement replay",
      "has_table_privilege('service_role', 'public.orders', 'UPDATE')",
      "listing order snapshots are immutable",
      "baseline_payments",
      "baseline_fulfilment",
      "baseline_notifications",
      "baseline_inventory",
      "baseline_ledger_journals",
      "baseline_ledger_entries",
      "120 loop",
      "prune_listing_order_vendor_transitions",
      "one session",
      "does not fake",
      "separate multi-session harness",
    ]) {
      expect(probe, `probe missing ${token}`).toContain(token);
    }
    expect(probe).not.toMatch(/raise\s+(notice|warning)[^;]*secret/i);
    expect(probe).not.toMatch(
      /select\s+[^;]*(intent_secret|capability_secret)/i,
    );
  });
});
