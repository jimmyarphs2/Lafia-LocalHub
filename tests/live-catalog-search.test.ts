import { describe, expect, it } from "vitest";

import {
  FICTIONAL_DEMO_PROVENANCE,
  filterCatalogRecordsForMode,
  LIVE_SUPABASE_PROVENANCE,
  listings as fictionalListings,
  type CatalogLocation,
  type Category,
  type Listing,
  type Vendor,
} from "@/lib/catalog/data";
import { parseSearchIntent, searchListings } from "@/lib/catalog/search";

const liveCategory: Category = {
  id: "11111111-1111-4111-8111-111111111111",
  marketId: "22222222-2222-4222-8222-222222222222",
  slug: "artisan-services",
  name: "Artisan services",
  aliases: ["guildword", "artisan expert"],
  description: "Live category supplied by the catalog adapter.",
};

const liveLocation: CatalogLocation = {
  id: "33333333-3333-4333-8333-333333333333",
  slug: "central-quay",
  name: "Central Quay",
  coordinates: { latitude: 8.491, longitude: 8.516 },
};

const liveListing = (overrides: Partial<Listing> = {}): Listing => ({
  id: "44444444-4444-4444-8444-444444444444",
  marketId: "22222222-2222-4222-8222-222222222222",
  businessId: "55555555-5555-4555-8555-555555555555",
  categoryId: liveCategory.id,
  locationId: liveLocation.id,
  slug: "live-artisan-service",
  routeKey: "live-artisan~live-artisan-service",
  vendor: "live-artisan",
  title: "Skilled local service",
  category: liveCategory.slug,
  location: "Central Quay",
  serviceAreas: ["Central Quay"],
  capabilityTags: [],
  availabilityWindows: ["on-request"],
  description: "A live catalog listing.",
  isOrderable: false,
  currencyCode: "NGN",
  priceMinor: 1_200_000,
  priceRangeNaira: { min: 12_000, max: 12_000 },
  priceNote: "Confirm the current quote with the vendor.",
  availabilityNote: "Confirm availability with the vendor.",
  color: "#245f4b",
  provenance: LIVE_SUPABASE_PROVENANCE,
  ...overrides,
});

describe("live catalog search boundary", () => {
  it("matches published cake text when optional capability metadata is absent", () => {
    const cakeCategory: Category = {
      ...liveCategory,
      slug: "cakes-bakes",
      name: "Cakes & Bakes — fictional QA",
      aliases: ["cake", "cakes", "bakery"],
    };
    const cakeListing = liveListing({
      category: cakeCategory.slug,
      categoryId: cakeCategory.id,
      title: "Made-to-order cakes — fictional QA",
      description: "Fictional listing used only for pre-launch testing.",
      capabilityTags: [],
      routeKey: "lafia-bakes-qa~made-to-order-cakes",
      slug: "made-to-order-cakes",
      vendor: "lafia-bakes-qa",
    });

    const result = searchListings("birthday cake", "lafia", [cakeListing], {
      categories: [cakeCategory],
      locations: [],
    });

    expect(result.intent.capabilityTags).toEqual(
      expect.arrayContaining(["birthday-cake", "cake"]),
    );
    expect(result.results.map(({ routeKey }) => routeKey)).toEqual([
      "lafia-bakes-qa~made-to-order-cakes",
    ]);
  });

  it("uses supplied live category aliases instead of the static demo taxonomy", () => {
    const collidingCategory: Category = {
      ...liveCategory,
      id: "99999999-9999-4999-8999-999999999999",
      aliases: ["different guild"],
    };
    const source = [
      liveListing(),
      liveListing({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        categoryId: collidingCategory.id,
        slug: "same-slug-other-category",
      }),
    ];

    expect(
      parseSearchIntent("guildword", {
        categories: [liveCategory, collidingCategory],
      }),
    ).toMatchObject({
      categorySlugs: [liveCategory.slug],
      categoryIds: [liveCategory.id],
    });
    expect(
      searchListings("guildword", "lafia", source, {
        categories: [liveCategory, collidingCategory],
        locations: [],
      }).results.map(({ slug }) => slug),
    ).toEqual(["live-artisan-service"]);

    expect(
      searchListings("guildword", "lafia", source, {
        categories: [],
        locations: [],
      }).results,
    ).toEqual([]);
  });

  it("does not fall back to fictional demo coordinates when live locations are explicitly empty", () => {
    const productionIntent = parseSearchIntent(
      "guildword around Shendam Road",
      {
        categories: [liveCategory],
        locations: [],
      },
    );

    expect(productionIntent.categorySlugs).toEqual([liveCategory.slug]);
    expect(productionIntent.location).toBeUndefined();
    expect(productionIntent.locationLabel).toBeUndefined();
    expect(productionIntent.locationCoordinates).toBeUndefined();

    // This confirms the adversarial phrase would have resolved only through the
    // deliberately separate fictional-demo fallback.
    expect(
      parseSearchIntent("around Shendam Road").locationCoordinates,
    ).toEqual(expect.objectContaining({ latitude: expect.any(Number) }));
  });

  it("excludes and renormalizes distance when a live listing has no coordinates", () => {
    const result = searchListings(
      "artisan expert near Central Quay",
      "lafia",
      [liveListing({ coordinates: undefined })],
      {
        categories: [liveCategory],
        locations: [liveLocation],
      },
    );
    const match = result.matches[0];
    const relevance = match.components.find(
      ({ dimension }) => dimension === "relevance",
    );
    const distance = match.components.find(
      ({ dimension }) => dimension === "distance",
    );

    expect(match.listing.slug).toBe("live-artisan-service");
    expect(distance?.score).toBeNull();
    expect(distance?.reason).toContain("No listing coordinates are published");
    expect(match.missingEvidence).toContain("distance");
    expect(match.score).toBe(relevance?.score);
    expect(match.scoreNotice).not.toContain("fictional demo");
  });

  it("ranks supplied live coordinates deterministically regardless of source order", () => {
    const close = liveListing({
      id: "66666666-6666-4666-8666-666666666666",
      slug: "a-close-artisan",
      coordinates: liveLocation.coordinates,
    });
    const distant = liveListing({
      id: "77777777-7777-4777-8777-777777777777",
      slug: "z-distant-artisan",
      coordinates: { latitude: 9.25, longitude: 9.25 },
    });
    const context = {
      categories: [liveCategory],
      locations: [liveLocation],
    };

    const forward = searchListings(
      "artisan expert near Central Quay",
      "lafia",
      [distant, close],
      context,
    );
    const reversed = searchListings(
      "artisan expert near Central Quay",
      "lafia",
      [close, distant],
      context,
    );

    expect(forward.results.map(({ slug }) => slug)).toEqual([
      "a-close-artisan",
      "z-distant-artisan",
    ]);
    expect(reversed.results.map(({ slug }) => slug)).toEqual(
      forward.results.map(({ slug }) => slug),
    );
    expect(
      forward.matches[0].components.find(
        ({ dimension }) => dimension === "distance",
      )?.score,
    ).toBeGreaterThan(
      forward.matches[1].components.find(
        ({ dimension }) => dimension === "distance",
      )?.score ?? -1,
    );
  });

  it("uses collision-safe route keys as the final deterministic tie-break", () => {
    const alpha = liveListing({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      businessId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      slug: "shared-offer",
      routeKey: "alpha-vendor~shared-offer",
      vendor: "alpha-vendor",
    });
    const zeta = liveListing({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      businessId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      slug: "shared-offer",
      routeKey: "zeta-vendor~shared-offer",
      vendor: "zeta-vendor",
    });
    const context = { categories: [liveCategory], locations: [] };

    const forward = searchListings(
      "guildword",
      "lafia",
      [zeta, alpha],
      context,
    ).results.map(({ routeKey }) => routeKey);
    const reversed = searchListings(
      "guildword",
      "lafia",
      [alpha, zeta],
      context,
    ).results.map(({ routeKey }) => routeKey);

    expect(forward).toEqual([
      "alpha-vendor~shared-offer",
      "zeta-vendor~shared-offer",
    ]);
    expect(reversed).toEqual(forward);
  });

  it("keeps fictional fixtures behind demo mode while accepting coordinate-optional live records", () => {
    const vendorWithoutCoordinates: Vendor = {
      id: "88888888-8888-4888-8888-888888888888",
      marketId: "22222222-2222-4222-8222-222222222222",
      locationId: null,
      slug: "live-artisan",
      name: "Live Artisan",
      category: liveCategory.slug,
      location: "Location not published",
      serviceAreas: [],
      capabilityTags: [],
      summary: "A live vendor profile.",
      color: "#245f4b",
      provenance: LIVE_SUPABASE_PROVENANCE,
    };
    const productionRecords = filterCatalogRecordsForMode(
      [fictionalListings[0], liveListing({ coordinates: undefined })],
      false,
    );

    expect(vendorWithoutCoordinates.coordinates).toBeUndefined();
    expect(fictionalListings.every((listing) => !listing.isOrderable)).toBe(
      true,
    );
    expect(productionRecords).toHaveLength(1);
    expect(productionRecords[0].provenance).toEqual(LIVE_SUPABASE_PROVENANCE);
    expect(
      filterCatalogRecordsForMode(
        [fictionalListings[0], liveListing()],
        true,
      ).map(({ provenance }) => provenance),
    ).toEqual([FICTIONAL_DEMO_PROVENANCE, LIVE_SUPABASE_PROVENANCE]);
  });
});
