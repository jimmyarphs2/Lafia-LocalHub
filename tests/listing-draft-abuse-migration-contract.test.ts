import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290016_localhub_listing_draft_abuse_and_taxonomy_locks.sql",
  ),
  "utf8",
);
const wrapper = migration.slice(
  migration.lastIndexOf(
    "create or replace function public.save_listing_draft(",
  ),
);
const taxonomyLock = migration.slice(
  migration.indexOf(
    "create or replace function private.lock_active_listing_draft_taxonomy(",
  ),
  migration.indexOf(
    "alter function private.resolve_listing_draft_taxonomy(uuid)",
  ),
);

describe("listing draft abuse and taxonomy hardening", () => {
  it("wraps the exact deployed function instead of copying its core", () => {
    expect(migration).toContain("pg_catalog.pg_get_functiondef(");
    expect(migration).toContain(
      "alter function public.save_listing_draft_core(\n  uuid,",
    );
    expect(migration).toContain(
      ") set schema private;\n\nrevoke all on function private.save_listing_draft_core(",
    );
    expect(migration).toContain(
      "from public, anon, authenticated, service_role;",
    );
    expect(wrapper).toContain(
      "grant execute on function public.save_listing_draft(",
    );
    expect(wrapper).toContain(") to authenticated;");
  });

  it("derives bounded create and save windows from the authenticated actor", () => {
    expect(migration).toContain(
      "create table private.listing_draft_actor_rate_limits",
    );
    expect(migration).toContain("actor uuid := (select auth.uid())");
    expect(migration).toContain(
      "when 'listing_draft_create' then\n      max_requests := 30;\n      window_seconds := 86400;",
    );
    expect(migration).toContain(
      "when 'listing_draft_save' then\n      max_requests := 240;\n      window_seconds := 3600;",
    );
    expect(migration).toContain(
      "alter table private.listing_draft_actor_rate_limits enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table private.listing_draft_actor_rate_limits\n  from public, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "revoke all on function private.consume_listing_draft_rate_limit(text)\n  from public, anon, authenticated, service_role",
    );
  });

  it("serializes create replays before rate and business-cap enforcement", () => {
    const advisory = wrapper.indexOf("pg_advisory_xact_lock");
    const replayLookup = wrapper.indexOf(
      "from private.listing_draft_create_requests request",
    );
    const replayReturn = wrapper.indexOf(
      "from private.save_listing_draft_core(",
    );
    const createLimit = wrapper.indexOf("'listing_draft_create'");
    const openDraftCount = wrapper.indexOf("select count(*)::integer");
    const taxonomy = wrapper.indexOf(
      "from private.resolve_listing_draft_taxonomy(p_business_id)",
    );
    const finalCore = wrapper.lastIndexOf(
      "from private.save_listing_draft_core(",
    );

    expect(advisory).toBeGreaterThan(-1);
    expect(advisory).toBeLessThan(replayLookup);
    expect(replayLookup).toBeLessThan(replayReturn);
    expect(replayReturn).toBeLessThan(createLimit);
    expect(createLimit).toBeLessThan(openDraftCount);
    expect(openDraftCount).toBeLessThan(taxonomy);
    expect(taxonomy).toBeLessThan(finalCore);
    expect(wrapper).toContain("listing.business_id = p_business_id");
    expect(wrapper).toContain("listing.status = 'draft'");
    expect(wrapper).toContain("if open_draft_count >= 50 then");
  });

  it("locks and rechecks taxonomy retirement fields in one order", () => {
    const category = taxonomyLock.indexOf("from public.categories c");
    const mapping = taxonomyLock.indexOf(
      "from public.category_listing_type_mappings mapping",
    );
    const listingType = taxonomyLock.indexOf("from public.listing_types lt");
    const schema = taxonomyLock.indexOf("from public.listing_schemas s");

    expect(category).toBeGreaterThan(-1);
    expect(category).toBeLessThan(mapping);
    expect(mapping).toBeLessThan(listingType);
    expect(listingType).toBeLessThan(schema);
    expect(taxonomyLock.match(/for share/g)).toHaveLength(4);
    expect(taxonomyLock).toContain("and mapping.is_default");
    expect(taxonomyLock).toContain("and lt.is_active");
    expect(taxonomyLock).toContain("and s.status = 'published'");
    expect(taxonomyLock).toContain("raise exception 'schema_stale'");
    expect(migration).toContain(
      "rename to resolve_listing_draft_taxonomy_core",
    );
    expect(migration).toContain(
      "perform private.lock_active_listing_draft_taxonomy(",
    );
  });

  it("keeps cleanup bounded, lock-safe, and service-role only", () => {
    expect(migration).toContain(
      "listing_draft_create_requests_completed_retention_idx",
    );
    expect(migration).toContain("interval '30 days'");
    expect(migration).toContain("interval '24 hours'");
    expect(migration).toContain("interval '48 hours'");
    expect(migration.match(/for update skip locked/g)).toHaveLength(2);
    expect(migration).toContain("p_batch_size not between 1 and 2000");
    expect(migration).toContain(
      "revoke execute on function public.prune_listing_draft_internal_state(integer)\n  from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.prune_listing_draft_internal_state(integer)\n  to service_role",
    );
  });
});
