import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608300024_localhub_order_fulfilment_processing.sql",
  ),
  "utf8",
);
const indexHardeningMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608300025_localhub_order_fulfilment_fk_indexes.sql",
  ),
  "utf8",
);
const contract = readFileSync(
  resolve(
    process.cwd(),
    "docs/LOCALHUB_ORDER_FULFILMENT_PROCESSING_CONTRACT.md",
  ),
  "utf8",
);
const probe = readFileSync(
  resolve(
    process.cwd(),
    "supabase/tests/order_fulfilment_processing_probe.sql",
  ),
  "utf8",
);

function section(start: string, end?: string) {
  const startAt = migration.indexOf(start);
  expect(startAt, `missing migration section: ${start}`).toBeGreaterThanOrEqual(
    0,
  );
  const endAt = end ? migration.indexOf(end, startAt + start.length) : -1;
  return migration.slice(startAt, endAt < 0 ? undefined : endAt);
}

describe("protected order fulfilment processing migration contract", () => {
  it("creates one timestamp-concordant canonical aggregate and normalized event", () => {
    const aggregate = section(
      "create table public.order_fulfilments",
      "create table private.listing_order_fulfilment_processing",
    );
    expect(aggregate).toContain("order_id uuid not null unique");
    expect(aggregate).toContain(
      "references public.orders(id) on delete restrict",
    );
    expect(aggregate).toContain(
      "status text not null check (status = 'processing')",
    );
    expect(aggregate).toContain("unique (id, order_id)");
    expect(aggregate).toContain(
      "check (started_at = created_at and created_at = updated_at)",
    );
    expect(aggregate).toContain("fulfilment_id uuid");
    expect(aggregate).toContain("actor_id uuid");
    expect(aggregate).toContain(
      "references public.profiles(id) on delete set null",
    );
    expect(aggregate).toContain(
      "legacy fulfilment events must be reconciled before processing migration",
    );
    expect(aggregate).toContain("fulfilment_events_fulfilment_order_fkey");
    expect(aggregate).toContain("foreign key (fulfilment_id, order_id)");
    expect(aggregate).toContain(
      "references public.order_fulfilments(id, order_id)",
    );
    expect(aggregate).toContain("event_type = 'processing_started'");
    expect(aggregate).toContain("status = 'processing'");
    expect(aggregate).toContain("payload = '{}'::jsonb");
    expect(aggregate).toContain(
      "fulfilment_events_one_processing_started_per_fulfilment_idx",
    );
    expect(aggregate).toContain("fulfilment_events_actor_idx");
    expect(aggregate).not.toContain("unique (fulfilment_id)");
  });

  it("uses a separate private idempotency ledger and actor-first fixed-window limiter", () => {
    for (const table of [
      "private.listing_order_fulfilment_processing",
      "private.listing_order_fulfilment_processing_rate_limits",
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
    expect(migration).toContain(
      "listing_order_fulfilment_processing_fulfilment_order_fkey",
    );
    expect(migration).toContain("foreign key (fulfilment_id, order_id)");
    expect(indexHardeningMigration).toContain(
      "listing_order_fulfilment_processing_fulfilment_order_idx",
    );
    expect(indexHardeningMigration).toContain(
      "private.listing_order_fulfilment_processing(fulfilment_id, order_id)",
    );
    expect(indexHardeningMigration).toContain(
      "fulfilment_events_fulfilment_order_idx",
    );
    expect(indexHardeningMigration).toContain(
      "public.fulfilment_events(fulfilment_id, order_id)",
    );
    expect(migration).toContain("command = 'start_processing'");
    expect(migration).toContain("request_count between 0 and 121");
    expect(migration).toContain("return current_count <= 120;");
    const wrapper = section(
      "create or replace function public.start_listing_order_fulfilment(",
      "-- PostgreSQL cannot change RETURNS TABLE shapes",
    );
    expect(
      wrapper.indexOf("from public.profiles profile"),
    ).toBeGreaterThanOrEqual(0);
    expect(
      wrapper.indexOf(
        "private.consume_listing_order_fulfilment_processing_rate_limit",
      ),
    ).toBeLessThan(wrapper.indexOf("private.start_listing_order_fulfilment"));
  });

  it("fails closed on input, current authority, state, and forged transaction context", () => {
    const core = section(
      "create or replace function private.start_listing_order_fulfilment(",
      "create or replace function public.start_listing_order_fulfilment(",
    );
    expect(core).toContain(
      "(select auth.role()) is distinct from 'authenticated'",
    );
    expect(core).toContain("profile.id = actor and not profile.is_suspended");
    expect(core).toContain("business.status = 'active'");
    expect(core).toContain("membership.business_id = order_row.business_id");
    expect(core).toContain("membership.accepted_at is not null");
    expect(core).toContain("membership.role in ('owner', 'manager', 'staff')");
    expect(core).toContain("p_idempotency_key::text");
    expect(core).toContain("!~ '^[0-9a-f]{8}-[0-9a-f]{4}-4");
    expect(core).toContain("pg_advisory_xact_lock");
    expect(core).toContain("listing_order_fulfilment_processing:'");
    expect(
      core.indexOf("from private.listing_order_fulfilment_processing"),
    ).toBeLessThan(core.indexOf("from public.orders orders"));
    const guard = section(
      "create or replace function public.prevent_listing_order_fulfilment_mutation()",
      "create or replace function private.consume_listing_order_fulfilment_processing_rate_limit()",
    );
    expect(guard).toContain("is distinct from");
    expect(guard).toContain(
      "private.is_consistent_confirmed_listing_order(new.order_id)",
    );
    expect(guard).toContain("new.started_at < parent_order.vendor_decided_at");
    expect(guard).toContain(
      "processing_actor is distinct from new.actor_id::text",
    );
    expect(guard).toContain("listing order fulfilment history is immutable");
  });

  it("writes one append-only aggregate, event, private replay record, and minimized audit without changing the order", () => {
    const core = section(
      "create or replace function private.start_listing_order_fulfilment(",
      "create or replace function public.start_listing_order_fulfilment(",
    );
    expect(core).toContain("order_row.status <> 'confirmed'");
    expect(core).toContain(
      "private.is_consistent_confirmed_listing_order(order_row.id)",
    );
    expect(core).toContain("clock_timestamp()");
    expect(core).toContain("insert into public.order_fulfilments(");
    expect(core).toContain("insert into public.fulfilment_events(");
    expect(core).toContain(
      "insert into private.listing_order_fulfilment_processing(",
    );
    expect(core).toContain("insert into public.audit_events(");
    expect(core).toContain("'order.fulfilment_processing_started'");
    expect(core).toContain("'to_status', 'processing'");
    expect(core).toContain("private.is_consistent_processing_listing_order(");
    expect(core).not.toContain("update public.orders");
    expect(core).not.toContain("insert into public.order_status_events");
    expect(migration).toContain(
      "prevent_listing_order_fulfilment_audit_mutation",
    );
    expect(migration).toContain(
      "listing order fulfilment audit evidence is immutable",
    );
    expect(migration).toContain(
      "invalid listing order fulfilment processing audit insert",
    );
    for (const excluded of [
      "public.payments",
      "public.payment_events",
      "public.inventory_levels",
      "public.notifications",
      "public.ledger_journals",
      "public.ledger_entries",
    ]) {
      expect(core).not.toContain(`insert into ${excluded}`);
    }
  });

  it("returns the prefixed all-or-nothing fulfilment DTO and preserves placement replay", () => {
    const publicRpc = section(
      "create or replace function public.start_listing_order_fulfilment(",
      "-- PostgreSQL cannot change RETURNS TABLE shapes",
    );
    for (const outcome of [
      "'started'",
      "'replayed'",
      "'already_started'",
      "'idempotency_key_reused'",
      "'not_found'",
      "'invalid'",
      "'rate_limited'",
    ]) {
      expect(migration).toContain(outcome);
    }
    expect(publicRpc).toContain("fulfilment_started_at timestamptz");
    expect(publicRpc).toContain("fulfilment_updated_at timestamptz");
    const replay = section(
      "create function public.create_listing_order_from_intent(",
      "-- Recreate safe customer/vendor projections",
    );
    expect(replay).toContain("fulfilment_id uuid");
    expect(replay).toContain("fulfilment_status text");
    expect(replay).toContain("fulfilment_started_at timestamptz");
    expect(replay).toContain("fulfilment_updated_at timestamptz");
    expect(replay).toContain("private.is_consistent_processing_listing_order(");
    expect(replay).toContain("existing_fulfilment.id");
    expect(replay).toContain("existing_fulfilment.updated_at");
  });

  it("hardens active-profile RLS and omits actor/payload from application grants", () => {
    expect(migration).toContain(
      "order_fulfilments_active_customer_or_vendor_select",
    );
    expect(migration).toContain(
      "fulfilment_events_active_customer_or_vendor_select",
    );
    expect(migration).toContain("drop policy if exists fulfilment_visible");
    expect(migration).toContain(
      "private.can_current_actor_view_order(fulfilment_events.order_id)",
    );
    expect(migration).toContain(
      "grant select (id, order_id, status, started_at, created_at, updated_at)",
    );
    expect(migration).toContain(
      "grant select (id, order_id, fulfilment_id, status, event_type, occurred_at)",
    );
    expect(migration).toContain(
      "revoke all on table public.order_fulfilments, public.fulfilment_events",
    );
    expect(migration).toContain(
      "revoke insert, update, delete, truncate on table public.audit_events",
    );
    expect(migration).not.toMatch(
      /grant\s+(insert|update|delete)[\s\S]*public\.(order_fulfilments|fulfilment_events)/i,
    );
  });

  it("uses bounded service-only cleanup and a rollback-only adversarial probe", () => {
    const cleanup = section(
      "create or replace function public.prune_listing_order_fulfilment_processing(",
      "-- Active-profile-aware read policies",
    );
    expect(cleanup).toContain("p_batch_size not between 1 and 2000");
    expect(cleanup).toContain("service role is required");
    expect(cleanup).toContain("interval '30 days'");
    expect(cleanup).toContain("interval '48 hours'");
    expect(cleanup.match(/for update skip locked/g)).toHaveLength(2);
    expect(
      probe.trimStart().startsWith("-- Rollback-only live regression probe"),
    ).toBe(true);
    expect(probe).toMatch(/\nbegin;\n/);
    expect(probe.trimEnd().endsWith("rollback;")).toBe(true);
    for (const token of [
      "owner",
      "manager",
      "staff",
      "pending",
      "foreign",
      "suspended",
      "inactive",
      "replayed",
      "already_started",
      "idempotency_key_reused",
      "120 loop",
      "GUC-forged",
      "active-business placed order",
      "different-employee",
      "revoked membership replay",
      "suspended vendor saw",
      "buyer_id",
      "invalid cleanup batch",
      "direct aggregate delete",
      "direct event delete",
      "direct processing audit delete",
      "GUC-forged service processing audit insert",
      "processing placement replay",
      "baseline_fulfilment_aggregates",
      "baseline_payment_events",
      "separate multi-session harness",
    ]) {
      expect(probe, `probe missing ${token}`).toContain(token);
    }
    expect(probe).not.toMatch(/raise\s+(notice|warning)[^;]*secret/i);
    expect(probe).not.toMatch(
      /select\s+[^;]*(intent_secret|capability_secret)/i,
    );
    expect(probe).not.toContain("nextval(");
  });

  it("stays within the frozen processing-only product boundary", () => {
    expect(contract).toContain("Order state:** remains `confirmed`");
    expect(contract).toContain("not started -> processing");
    expect(contract).toContain("does not assert");
    expect(contract).toContain("ON DELETE SET NULL");
    expect(contract).toContain(
      "must therefore not set `orders.status = 'fulfilled'`",
    );
    const core = section(
      "create or replace function private.start_listing_order_fulfilment(",
      "create or replace function public.start_listing_order_fulfilment(",
    );
    expect(core).not.toContain("fulfilled");
    expect(core).not.toContain("tracking");
    expect(core).not.toContain("carrier");
    expect(core).not.toContain("address");
  });
});
