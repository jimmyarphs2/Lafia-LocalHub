import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608300020_localhub_listing_request_vendor_response_rate_limit.sql",
  ),
  "utf8",
);

describe("listing request vendor response rate-limit migration", () => {
  it("moves the audited transition behind one public throttled wrapper", () => {
    expect(migration).toContain(
      "alter function public.respond_to_listing_request(uuid, text, uuid)\n  set schema private",
    );
    expect(migration).toContain(
      "revoke all on function private.respond_to_listing_request(uuid, text, uuid)",
    );
    expect(migration).toContain(
      "create function public.respond_to_listing_request(",
    );
    expect(migration).toContain(
      "private.consume_listing_request_vendor_response_rate_limit()",
    );
    expect(migration).toContain("from private.respond_to_listing_request(");
    expect(migration.indexOf("'rate_limited'")).toBeGreaterThan(
      migration.indexOf(
        "private.consume_listing_request_vendor_response_rate_limit()",
      ),
    );
    expect(
      migration.indexOf("from private.respond_to_listing_request("),
    ).toBeGreaterThan(migration.indexOf("'rate_limited'"));
  });

  it("serializes a bounded active-actor window before request lookup", () => {
    expect(migration).toContain(
      "create table private.listing_request_vendor_response_rate_limits",
    );
    expect(migration).toContain("primary key references public.profiles(id)");
    expect(migration).toContain("on conflict(actor_id) do update");
    expect(migration).toContain("interval '1 hour'");
    expect(migration).toContain("return current_count <= 120");
    expect(migration).toContain("or not public.is_active_profile(actor) then");
    expect(migration).toContain(
      "alter table private.listing_request_vendor_response_rate_limits enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table private.listing_request_vendor_response_rate_limits",
    );
  });

  it("keeps rate state prunable only by service role", () => {
    expect(migration).toContain(
      "public.prune_listing_request_vendor_response_rate_limits(",
    );
    expect(migration).toContain("interval '48 hours'");
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("service role is required");
    expect(migration).toContain(
      "grant execute on function public.prune_listing_request_vendor_response_rate_limits(integer)\n  to service_role",
    );
  });
});
