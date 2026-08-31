import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290013_localhub_listing_draft_workspace.sql",
  ),
  "utf8",
);
const demoSeed = readFileSync(
  resolve(process.cwd(), "supabase/seed.sql"),
  "utf8",
);
const hardeningMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290015_localhub_listing_draft_idempotency_index.sql",
  ),
  "utf8",
);

describe("listing draft database boundary", () => {
  it("removes direct app-role writes and exposes only authenticated RPCs", () => {
    expect(migration).toContain(
      "revoke insert, update, delete on public.listings",
    );
    for (const policy of [
      "listings_manager_insert",
      "listings_manager_update",
      "listings_manager_delete",
    ]) {
      expect(migration).toContain(`drop policy if exists ${policy}`);
    }
    expect(migration).toContain(
      "grant execute on function public.get_listing_draft_context(uuid, uuid)",
    );
    expect(migration).toContain(
      "grant execute on function public.save_listing_draft(",
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.(get_listing_draft_context|save_listing_draft)[\s\S]*?to anon;/,
    );
  });

  it("derives tenant and taxonomy while keeping publication fields fixed", () => {
    expect(migration).toContain("public.is_business_manager(p_business_id)");
    expect(migration).toContain("d.step = 'complete'");
    expect(migration).toContain("d.submitted_at is not null");
    expect(migration).toContain("b.status in ('pending_review', 'active')");
    expect(migration).toContain("and mapping.is_default");
    expect(migration).toContain("and s.status = 'published'");
    expect(migration).toContain("and s.published_at is not null");
    expect(migration).toContain("b.currency_code::text");
    expect(migration).toContain('"values" jsonb');
    expect(migration).toContain("'draft',");
    expect(migration).toContain("null,\n      actor");
    expect(migration).not.toContain("other-local-trade");
  });

  it("keeps the optional demo seed compatible with the authoritative contract", () => {
    expect(demoSeed).toContain('"contractVersion":"1.1"');
    expect(demoSeed).toContain('"key":"origin_note"');
    expect(demoSeed).not.toContain('"key":"originNote"');
  });

  it("validates the full authoritative ALE document and locks published identity", () => {
    for (const key of [
      "contractVersion",
      "schemaVersion",
      "schemaKey",
      "listingKind",
      "terminology",
      "bindings",
      "fields",
    ]) {
      expect(migration).toContain(`'${key}'`);
    }
    expect(migration).toContain(
      "p_schema ->> 'contractVersion' is distinct from '1.1'",
    );
    expect(migration).toContain("old.published_at is not null and (");
    expect(migration).toContain(
      "create unique index listing_schemas_ale_schema_key_idx",
    );
    expect(migration).toContain("draft_values_invalid");
  });

  it("serializes retries and prevents stale edits", () => {
    expect(migration).toContain("primary key (actor_id, idempotency_key)");
    expect(migration).toContain("extensions.digest(");
    expect(migration).toContain("for update;");
    expect(migration).toContain("idempotency_key_reused");
    expect(migration).toContain("draft_revision_conflict");
    expect(migration).toContain("draft_revision = l.draft_revision + 1");
    expect(migration).toContain("and l.draft_revision = p_expected_revision");
    expect(hardeningMigration).toContain(
      "create index listing_draft_create_requests_business_idx",
    );
  });

  it("pins edits to their stored active mapping instead of silently migrating", () => {
    expect(migration).toContain("mapping.category_id = draft.category_id");
    expect(migration).toContain(
      "mapping.listing_type_id = draft.listing_type_id",
    );
    expect(migration).toContain(
      "mapping.listing_schema_id = draft.listing_schema_id",
    );
    expect(migration).toContain("raise exception 'taxonomy_stale'");
    expect(migration).toContain("raise exception 'schema_stale'");
  });
});
