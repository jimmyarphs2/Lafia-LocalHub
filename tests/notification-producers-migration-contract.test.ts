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
  "supabase/migrations/202608310036_localhub_notification_producers.sql";
const probePath = "supabase/tests/notification_producers_probe.sql";

describe("transactional in-app notification producer migration", () => {
  it("refuses drift, partial installation, historical backfill, or active delivery state", () => {
    const sql = compact(read(migrationPath));

    expect(sql).toContain("set local lock_timeout = '10s'");
    expect(sql).toContain("set local statement_timeout = '120s'");
    expect(sql).toContain("lock table public.profiles");
    expect(sql).toContain("public.requests");
    expect(sql).toContain("public.orders");
    expect(sql).toContain("public.order_fulfilments");
    expect(sql).toContain("public.notifications");
    expect(sql).toContain("private.notification_deliveries");
    for (const relation of [
      "public.requests",
      "public.orders",
      "public.order_fulfilments",
      "public.notifications",
      "private.notification_deliveries",
    ]) {
      expect(sql).toContain(`exists (select 1 from ${relation})`);
    }
    expect(sql).toContain("notification producer precondition failed");
    expect(sql).toContain("using errcode = '55000'");
    expect(sql).toContain("no partial notification producer objects");
  });

  it("owns all copy, templates, source identities, recipients, and action paths in PostgreSQL", () => {
    const sql = compact(read(migrationPath));

    expect(sql).toContain(
      "create function private.enqueue_fixed_in_app_notification",
    );
    for (const sourceKind of [
      "listing_request",
      "listing_order",
      "listing_order_fulfilment",
    ]) {
      expect(sql).toContain(`'${sourceKind}'`);
    }
    for (const template of [
      "vendor_request_created",
      "customer_request_accepted",
      "customer_request_declined",
      "vendor_order_placed",
      "customer_order_confirmed",
      "customer_order_cancelled",
      "customer_order_processing",
    ]) {
      expect(sql).toContain(`'${template}'`);
    }
    for (const copy of [
      "new customer request",
      "request accepted",
      "request declined",
      "new order",
      "order confirmed",
      "order cancelled",
      "order processing started",
    ]) {
      expect(sql).toContain(`'${copy}'`);
    }
    expect(sql).toContain("'/vendor/requests'");
    expect(sql).toContain("'/vendor/orders/'");
    expect(sql).toContain("'/requests/'");
    expect(sql).toContain("'/orders/'");
    expect(sql).toContain(
      "on conflict (profile_id, source_kind, source_id, template_key, template_version) do nothing",
    );
  });

  it("wraps only the five approved source boundaries after durable success", () => {
    const sql = compact(read(migrationPath));

    for (const boundary of [
      "create_listing_request_from_intent_source_boundary",
      "respond_to_listing_request_source_boundary",
      "create_listing_order_from_intent_source_boundary",
      "respond_to_listing_order_source_boundary",
      "start_listing_order_fulfilment_source_boundary",
    ]) {
      expect(sql).toContain(`rename to ${boundary}`);
      expect(sql).toContain(`private.${boundary}`);
    }
    for (const publicWrapper of [
      "public.create_listing_request_from_intent",
      "public.respond_to_listing_request",
      "public.create_listing_order_from_intent",
      "public.respond_to_listing_order",
      "public.start_listing_order_fulfilment",
    ]) {
      expect(sql).toContain(`create function ${publicWrapper}`);
    }
    expect(sql).toContain("response.outcome = 'created'");
    expect(sql).toContain("response.outcome = 'transitioned'");
    expect(sql).toContain("response.outcome = 'started'");
    expect(sql).toContain("membership.accepted_at is not null");
    expect(sql).toContain("membership.role in ('owner', 'manager', 'staff')");
    expect(sql).toContain("not recipient.is_suspended");
    expect(sql).toContain("order by recipient.id");
    expect(sql).not.toMatch(/create trigger .*notification/i);
    expect(sql).not.toMatch(
      /after (insert|update).*public\.(requests|orders|order_fulfilments)/,
    );
  });

  it("keeps producers private and external delivery impossible", () => {
    const sql = compact(read(migrationPath));

    expect(sql.match(/security definer/g) ?? []).toHaveLength(6);
    // Six SECURITY DEFINER producer/wrapper functions plus the revised
    // SECURITY INVOKER notification immutability trigger.
    expect(sql.match(/set search_path = ''/g) ?? []).toHaveLength(7);
    expect(sql).toContain(
      "alter function private.enqueue_fixed_in_app_notification",
    );
    expect(sql).toContain("owner to postgres");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql.match(/grant execute on function public\./g) ?? []).toHaveLength(
      5,
    );
    expect(sql).not.toMatch(/grant execute on function private\./);
    expect(sql).not.toMatch(
      /insert into private\.notification_deliveries|update private\.notification_deliveries|delete from private\.notification_deliveries/,
    );
    expect(sql).not.toMatch(/\b(email|sms|push|voice|whatsapp)\b/);
  });

  it("asserts exact source guards, wrapper ACLs, RLS, and publication safety", () => {
    const sql = compact(read(migrationPath));

    expect(sql).toContain("notification source mutation guard surface drifted");
    expect(sql).toContain("notification source dml acl drifted");
    expect(sql).toContain("notification source rpc precondition drifted");
    expect(sql).toContain("notification producer function surface drifted");
    expect(sql).toContain("notification producer function acl drifted");
    expect(sql).toContain("notification inbox rls surface drifted");
    expect(sql).toContain("notification realtime deletion safety drifted");
    expect(sql).toContain("notification delivery dormancy drifted");
    expect(sql).toContain("no partial notification producer objects");
    expect(sql).toContain("no persistent source rpc dependencies");
  });

  it("derives order destinations from canonical order_number, never the UUID", () => {
    const sql = compact(read(migrationPath));

    expect(sql).toContain("orders.order_number");
    expect(sql).toContain("'/vendor/orders/' || orders.order_number");
    expect(sql).toContain(
      "'/' || market.slug || '/orders/' || orders.order_number",
    );
    expect(sql).not.toContain("'/vendor/orders/' || p_source_id");
    expect(sql).not.toContain("'/orders/' || p_source_id");
  });

  it("ships a rollback-only behavioral probe covering recipients, replay, atomicity, and dormancy", () => {
    const sql = compact(read(probePath));

    expect(sql).toMatch(/^begin;/);
    expect(sql).toMatch(/rollback;$/);
    expect(sql).toContain("set local transaction_timeout");
    expect(sql).not.toContain("pg_catalog.setval");
    for (const evidence of [
      "vendor request notification cardinality",
      "accepted request notification cardinality",
      "declined request notification cardinality",
      "vendor order notification cardinality",
      "confirmed order notification cardinality",
      "cancelled order notification cardinality",
      "processing notification cardinality",
      "suspended recipient unexpectedly notified",
      "invited member unexpectedly notified",
      "foreign business member unexpectedly notified",
      "notification replay duplicated",
      "source transaction survived notification failure",
      "notification deliveries are dormant",
      "left notification producer fixture residue",
    ]) {
      expect(sql).toContain(evidence);
    }
  });
});
