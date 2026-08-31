import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290001_localhub_foundation.sql",
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

describe("media removal database lifecycle contract", () => {
  it("lets any current manager finish an exact removal after both resources are absent", () => {
    const contract = functionContract(
      "mark_listing_media_upload_removed",
      "cancel_listing_media_upload",
    );

    expect(contract).toContain("public.is_business_manager(l.business_id)");
    expect(contract).toContain("r.status = 'removed'");
    expect(contract).toContain(
      "not exists(select 1 from public.listing_media lm where lm.storage_path = p_storage_path)",
    );
    expect(contract).toContain(
      "not exists(select 1 from storage.objects o where o.bucket_id = 'listing-media' and o.name = p_storage_path)",
    );
    expect(contract).not.toContain("profile_id = actor");
  });

  it("lets any current manager idempotently cancel only after both resources are absent", () => {
    const contract = functionContract(
      "cancel_listing_media_upload",
      "expire_listing_media_upload_reservations",
    );

    expect(contract).toContain("public.is_business_manager(l.business_id)");
    expect(contract).toContain("r.status = 'cancelled'");
    expect(contract).toContain(
      "not exists(select 1 from public.listing_media lm where lm.storage_path = p_storage_path)",
    );
    expect(contract).toContain(
      "not exists(select 1 from storage.objects o where o.bucket_id = 'listing-media' and o.name = p_storage_path)",
    );
    expect(contract).not.toContain("profile_id = actor");
  });

  it("reclaims replayed removed objects only after the signed-target expiry boundary", () => {
    const contract = functionContract(
      "claim_orphan_listing_media_cleanup",
      "complete_orphan_listing_media_cleanup",
    );

    expect(contract).toContain(
      "not exists(select 1 from public.listing_media lm where lm.storage_path = r.storage_path)",
    );
    expect(contract).toContain(
      "r.status in ('reserved','expired','cancelled','removed') and r.expires_at <= now()",
    );
    expect(contract).toContain("for update skip locked");
  });

  it("uses the same 32-hex allowlisted canonical path contract in SQL", () => {
    expect(migration).toContain(
      "/[0-9a-f]{32}\\.(jpg|jpeg|png|webp|mp4|pdf)$'",
    );
    expect(migration).not.toContain(
      "/[A-Za-z0-9_-]{22,128}\\.[A-Za-z0-9]{2,8}$'",
    );
  });
});
