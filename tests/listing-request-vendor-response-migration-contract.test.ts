import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608300019_localhub_listing_request_vendor_responses.sql",
  ),
  "utf8",
);
const probe = readFileSync(
  resolve(
    process.cwd(),
    "supabase/tests/listing_request_vendor_response_probe.sql",
  ),
  "utf8",
);

describe("listing request vendor response migration contract", () => {
  it("keeps terminal vendor decisions exclusive to linked requests", () => {
    expect(migration).toContain(
      "drop constraint if exists requests_status_check",
    );
    expect(migration).toContain("status in ('open', 'accepted', 'declined')");
    expect(migration).toContain(
      "status in ('open', 'matched', 'closed', 'cancelled')",
    );
    expect(migration).toContain(
      "add column if not exists vendor_responded_at timestamptz",
    );
    expect(migration).toContain("requests_listing_response_consistency");
    expect(migration).toContain(
      "status = 'open' and vendor_responded_at is null",
    );
    expect(migration).toContain("status in ('accepted', 'declined')");
  });

  it("makes the response RPC the sole mutation route", () => {
    const trigger = migration.slice(
      migration.indexOf(
        "create or replace function public.enforce_listing_request_response_transition()",
      ),
      migration.indexOf(
        "create table private.listing_request_vendor_responses",
      ),
    );

    expect(trigger).toContain(
      "current_setting('localhub.listing_request_response', true)",
    );
    expect(trigger).toContain(
      "current_setting('localhub.listing_request_response_request_id', true)",
    );
    expect(trigger).toContain(
      "current_setting('localhub.listing_request_response_at', true)",
    );
    expect(trigger).toContain(
      "listing request response updates must use respond_to_listing_request",
    );
    expect(trigger).toContain("old.status <> 'open'");
    expect(trigger).toContain("new.status not in ('accepted', 'declined')");
    expect(trigger).toContain("new.vendor_responded_at is null");
    expect(trigger).toContain("old.title is distinct from new.title");
    expect(trigger).toContain("old.listing_id is distinct from new.listing_id");
    expect(trigger).toContain(
      "old.requester_id is distinct from new.requester_id",
    );
    expect(trigger).toContain(
      "old.guest_intent_id is not null and new.guest_intent_id is null",
    );
    expect(trigger).toContain(
      "old.vendor_responded_at is not distinct from new.vendor_responded_at",
    );
    expect(trigger).toContain("old.created_at is distinct from new.created_at");
    expect(migration).toContain(
      "revoke update on public.requests from public, anon, authenticated, service_role",
    );
    expect(migration).not.toMatch(
      /create policy\s+\S+\s+on public\.requests for update/i,
    );
  });

  it("uses an authenticated, locked, idempotent vendor response boundary", () => {
    const rpc = migration.slice(
      migration.indexOf(
        "create or replace function public.respond_to_listing_request(",
      ),
      migration.indexOf(
        "drop function if exists public.list_customer_listing_requests(text)",
      ),
    );

    expect(rpc).toContain("security definer");
    expect(rpc).toContain("set search_path = ''");
    expect(rpc).toContain("p_decision is null");
    expect(rpc).toContain("p_decision not in ('accept', 'decline')");
    expect(rpc).toContain("p_idempotency_key::text !~");
    expect(rpc).toContain("for share;");
    expect(rpc).toContain("pg_advisory_xact_lock");
    expect(rpc).toContain("for no key update;");
    expect(rpc).toContain("when 'decline' then target_status := 'declined'");
    expect(rpc).toContain("membership.role in ('owner', 'manager', 'staff')");
    expect(rpc).toContain("business.status = 'active'");
    expect(rpc).toContain("'replayed'");
    expect(rpc).toContain("'already_transitioned'");
    expect(rpc).toContain("'idempotency_key_reused'");
    expect(rpc).toContain("return query select null::uuid, 'not_found'");
    expect(rpc).toContain("return query select null::uuid, 'invalid'");
    expect(rpc).toContain(
      "listing request response replay state is inconsistent",
    );
    expect(rpc).toContain("insert into public.audit_events");
    expect(rpc).toContain("'listing_request.accepted'");
    expect(rpc).toContain("'listing_request.declined'");
    expect(rpc).toContain("'from_status', 'open'");
    expect(rpc).toContain("'to_status', target_status");
    expect(rpc).not.toContain("insert into public.orders");
    expect(rpc).not.toContain("insert into public.payments");
    expect(rpc).not.toContain("insert into public.request_matches");
    expect(rpc).not.toContain("insert into public.notifications");
  });

  it("keeps the replay ledger private, unique, and bounded", () => {
    expect(migration).toContain(
      "create table private.listing_request_vendor_responses",
    );
    expect(migration).toContain("primary key (actor_id, idempotency_key)");
    expect(migration).toContain("unique (request_id)");
    expect(migration).toContain(
      "alter table private.listing_request_vendor_responses enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table private.listing_request_vendor_responses",
    );
    expect(migration).toContain(
      "create or replace function public.prune_listing_request_vendor_responses(",
    );
    expect(migration).toContain("service role is required");
  });

  it("synchronizes the customer and vendor request projections", () => {
    for (const rpc of [
      "list_customer_listing_requests",
      "get_customer_listing_request",
      "list_vendor_listing_requests",
    ]) {
      const start = migration.indexOf(`create function public.${rpc}`);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(migration.slice(start, start + 2200)).toContain(
        "vendor_responded_at timestamptz",
      );
    }
    expect(migration).toContain(
      "grant execute on function public.respond_to_listing_request(uuid, text, uuid)\n  to authenticated",
    );
  });

  it("probes null decisions, service-role forgery, and retained intent cleanup", () => {
    expect(probe).toContain(
      "respond_to_listing_request(state.immutable_request_id, null::text",
    );
    expect(probe).toContain("public.prune_listing_request_intents(1)");
    expect(probe).toContain(
      "has_table_privilege('service_role', 'public.requests', 'UPDATE')",
    );
    expect(probe).toContain("request.guest_intent_id is null");
  });
});
