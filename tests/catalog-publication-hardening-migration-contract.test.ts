import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202609020039_localhub_catalog_publication_hardening.sql",
  ),
  "utf8",
);
const lockdown = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202609020040_localhub_catalog_publication_lockdown.sql",
  ),
  "utf8",
);
const probe = readFileSync(
  resolve(
    process.cwd(),
    "supabase/tests/catalog_publication_hardening_probe.sql",
  ),
  "utf8",
);

function compact(sql: string) {
  return sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();
}

describe("phase-zero catalogue publication boundary", () => {
  it("removes unapproved derivative delivery and fail-closes all public media reads", () => {
    const sql = compact(migration);
    const lockdownSql = compact(lockdown);

    for (const forbidden of [
      "listing_media_derivatives",
      "listing_media_derivative_status",
      "is_public_listing_media_derivative",
      "can_read_listing_media_object",
      "get_public_listing_media",
      "sanitized derivative",
    ]) {
      expect(sql).not.toContain(forbidden);
      expect(lockdownSql).not.toContain(forbidden);
    }
    expect(lockdownSql).toContain(
      "drop policy if exists listing_media_object_public_read",
    );
    expect(lockdownSql).toContain(
      "drop policy if exists listing_media_object_read",
    );
    expect(lockdownSql).toContain(
      "create policy listing_media_object_manager_read",
    );
    expect(lockdownSql).toContain("public.is_business_manager");
    expect(lockdownSql).toContain("storage.objects.name ~");
  });

  it("keeps stage 039 additive and confines source/media lockdown to stage 040", () => {
    const stageOne = compact(migration);
    const stageTwo = compact(lockdown);

    expect(stageOne).not.toContain(
      "drop policy if exists public_active_businesses_anon",
    );
    expect(stageOne).not.toContain("revoke select on public.businesses");
    expect(stageOne).not.toContain(
      "create policy businesses_authenticated_members_select",
    );
    expect(stageTwo).toContain(
      "revoke select on public.businesses, public.listings, public.listing_media, public.listing_variants, public.listing_availability from anon",
    );
    for (const policy of [
      "businesses_authenticated_members_select",
      "listings_authenticated_members_select",
      "listing_media_authenticated_managers_select",
      "listing_variants_authenticated_members_select",
      "listing_availability_authenticated_members_select",
    ]) {
      expect(stageTwo).toContain("create policy " + policy);
    }
    expect(stageTwo).not.toContain("create policy public_active_listings_anon");
    expect(stageTwo).not.toContain(
      "create policy public_active_businesses_anon",
    );
    expect(stageTwo).toContain(
      "catalogue source-table acl postcondition failed",
    );
    expect(stageTwo).toContain("catalogue member policy postcondition failed");
    for (const policy of [
      "businesses_authenticated_members_select",
      "listings_authenticated_members_select",
      "listing_media_authenticated_managers_select",
      "listing_variants_authenticated_members_select",
      "listing_availability_authenticated_members_select",
      "listing_media_object_manager_read",
    ]) {
      expect(stageTwo).toContain("policy_record.policyname = '" + policy + "'");
      expect(stageTwo).toContain("policy_record.cmd = 'select'");
      expect(stageTwo).toContain(
        "policy_record.roles = array['authenticated']::name[]",
      );
    }
  });

  it("exposes only bounded, canonical public catalogue RPC projections", () => {
    const sql = compact(migration);
    const businesses = sql.match(
      /create function public\.list_public_catalog_businesses[\s\S]*?\$\$;/,
    )?.[0];
    const listings = sql.match(
      /create function public\.list_public_catalog_listings[\s\S]*?\$\$;/,
    )?.[0];

    expect(businesses).toBeTruthy();
    expect(listings).toBeTruthy();
    expect(businesses).toContain("p_limit not between 1 and 250");
    expect(listings).toContain("p_limit not between 1 and 500");
    expect(businesses).not.toContain("address_text");
    for (const key of [
      "'summary'",
      "'serviceareas'",
      "'capabilitytags'",
      "'color'",
    ]) {
      expect(businesses).toContain(key);
    }
    for (const key of [
      "'availabilitynote'",
      "'availabilitywindows'",
      "'capabilitytags'",
      "'color'",
      "'pricenote'",
      "'serviceareas'",
      "has_active_variant",
    ]) {
      expect(listings).toContain(key);
    }
    expect(listings).toContain("listing_record.published_at is not null");
    expect(listings).toContain(
      "category_record.market_id = listing_record.market_id",
    );
    expect(listings).toContain("with eligible_businesses as");
    expect(listings).toContain(
      "order by business_record.name, business_record.id",
    );
    expect(listings).toContain("limit 250");
    expect(listings).toContain(
      "listing_record.business_id = eligible_business.id",
    );
    expect(businesses).toContain("service_areas");
    expect(businesses).toContain("capability_tags");
    for (const alias of [
      "availability_note",
      "availability_windows",
      "capability_tags",
      "price_note",
      "service_areas",
    ]) {
      expect(listings).toContain(alias);
    }
    expect(sql).toContain("create function private.catalog_public_text(");
    expect(sql).toContain("create function private.catalog_public_text_array(");
    expect(sql).toContain("create function private.catalog_public_color(");
    expect(sql).toContain("p_max_length not between 1 and 500");
    expect(sql).toContain("p_max_items not between 1 and 24");
    expect(sql).toContain("return '[]'::jsonb");
    expect(sql).toContain(
      "grant execute on function public.list_public_catalog_businesses(uuid, integer) to anon, authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.list_public_catalog_listings(uuid, integer) to anon, authenticated",
    );
  });

  it("uses trigger-created profiles, an ALE-valid fixture, and direct-role negative probes", () => {
    expect(probe).toContain("Run after migrations 039 and 040");
    expect(probe).not.toContain("insert into public.profiles");
    expect(probe).toContain("auth user trigger did not create probe profiles");
    expect(probe).toContain("private.is_supported_listing_schema_document");
    expect(probe).toContain("'contractVersion', '1.1'");
    expect(probe).toContain("'listingKind', 'product'");
    expect(probe).toContain(
      "anonymous source table read unexpectedly succeeded",
    );
    expect(probe).toContain(
      "authenticated outsider source read unexpectedly succeeded",
    );
    expect(probe).toContain("staff source boundary failed");
    expect(probe).toContain("manager original media access failed");
    expect(probe).toContain(
      "cross-business manager media access unexpectedly succeeded",
    );
    expect(probe).toContain(
      "suspended manager source access unexpectedly succeeded",
    );
    expect(probe).toContain(
      "anonymous catalogue projection allowlist or limit boundary failed",
    );
    expect(probe).toContain(
      "service role catalogue RPC unexpectedly succeeded",
    );
    expect(probe).toContain(
      "unaccepted membership source access unexpectedly succeeded",
    );
    expect(probe).toContain(
      "manager reserved original pre-registration access failed",
    );
    expect(probe).toContain(
      "non-manager reserved original pre-registration access succeeded",
    );
    expect(probe).toContain("secretMarker");
    expect(probe).toContain(
      "metadata - array['serviceAreas', 'capabilityTags', 'color']",
    );
    expect(probe).toContain("attributes - array[");
  });
});
