import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290014_localhub_draft_media_boundary.sql",
  ),
  "utf8",
);

function functionContract(functionName: string, nextFunctionName: string) {
  const start = migration.indexOf(
    `create or replace function public.${functionName}`,
  );
  const end = migration.indexOf(
    `create or replace function public.${nextFunctionName}`,
    start + 1,
  );
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("draft media database boundary", () => {
  it("requires a managed draft for reservation and confirmation", () => {
    for (const contract of [
      functionContract(
        "reserve_listing_media_upload",
        "confirm_listing_media_upload",
      ),
      functionContract(
        "confirm_listing_media_upload",
        "has_reserved_listing_media_upload",
      ),
    ]) {
      expect(contract).toContain("private.lock_managed_listing_draft(");
    }
    expect(migration).toContain("and l.status = 'draft'");
    expect(migration).toContain("for no key update of l;");
    expect(migration).toContain("private.lock_active_business_manager(");
  });

  it("keeps both storage and metadata registration draft-bound", () => {
    const reserved = functionContract(
      "has_reserved_listing_media_upload",
      "has_confirmed_listing_media_upload",
    );
    const confirmed = functionContract(
      "has_confirmed_listing_media_upload",
      "record_listing_media_registration",
    );
    expect(reserved).toContain("private.lock_managed_listing_draft(");
    expect(confirmed).toContain("private.lock_managed_listing_draft(");
    expect(migration).toContain("private.lock_listing_draft(new.listing_id)");
  });

  it("keeps private row-lock helpers unreachable to app roles", () => {
    expect(migration).toContain(
      "revoke execute on function private.lock_listing_draft(uuid)",
    );
    expect(migration).toContain(
      "revoke execute on function private.lock_managed_listing_draft(uuid, uuid)",
    );
  });

  it("does not replace cancellation, removal, or orphan-cleanup semantics", () => {
    expect(migration).not.toContain(
      "create or replace function public.cancel_listing_media_upload",
    );
    expect(migration).not.toContain(
      "create or replace function public.mark_listing_media_upload_removed",
    );
    expect(migration).not.toContain(
      "create or replace function public.claim_orphan_listing_media_cleanup",
    );
  });

  it("removes implicit execution and grants only intended app calls", () => {
    for (const signature of [
      "reserve_listing_media_upload(uuid, text)",
      "confirm_listing_media_upload(uuid, text)",
      "cancel_listing_media_upload(uuid, text)",
      "mark_listing_media_upload_removed(uuid, text)",
      "has_reserved_listing_media_upload(text)",
      "has_confirmed_listing_media_upload(uuid, text)",
    ]) {
      expect(migration).toContain(
        `revoke execute on function public.${signature}`,
      );
      expect(migration).toContain(
        `grant execute on function public.${signature}`,
      );
    }
  });
});
