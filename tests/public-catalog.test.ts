import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  createClient: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/config/env", () => ({
  getPublicSupabaseConfig: mocks.getConfig,
}));

import {
  getPublicCatalog,
  hasCompletePublicCatalogCoverage,
  mapPublicCatalogRows,
  parsePublicListingAttributes,
  type PublicBusinessRow,
  type PublicCatalogRows,
  type PublicCategoryAliasRow,
  type PublicCategoryRow,
  type PublicListingRow,
  type PublicLocationRow,
  type PublicMarketRow,
} from "@/lib/catalog/public-catalog";

describe("public catalog completeness", () => {
  const limits = {
    categories: 200,
    aliases: 500,
    locations: 250,
    vendors: 250,
    listings: 500,
  } as const;

  it("is complete only while every bounded source stays below its cap", () => {
    const below = {
      categories: 199,
      aliases: 499,
      locations: 249,
      vendors: 249,
      listings: 499,
    };
    expect(hasCompletePublicCatalogCoverage(below)).toBe(true);

    for (const field of Object.keys(limits) as Array<keyof typeof limits>) {
      expect(
        hasCompletePublicCatalogCoverage({
          ...below,
          [field]: limits[field],
        }),
        `${field} equality must be conservatively incomplete`,
      ).toBe(false);
    }
  });
});

const marketId = "11111111-1111-4111-8111-111111111111";
const otherMarketId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const locationId = "44444444-4444-4444-8444-444444444444";
const businessId = "55555555-5555-4555-8555-555555555555";
const listingId = "66666666-6666-4666-8666-666666666666";

const market: PublicMarketRow = {
  id: marketId,
  slug: "lafia",
  name: "Lafia",
  country_code: "NG",
  currency_code: "NGN",
  timezone: "Africa/Lagos",
  is_active: true,
};

const category: PublicCategoryRow = {
  id: categoryId,
  market_id: marketId,
  slug: "food-restaurants",
  name: "Food & restaurants",
  is_active: true,
};

const alias: PublicCategoryAliasRow = {
  id: "77777777-7777-4777-8777-777777777777",
  category_id: categoryId,
  market_id: marketId,
  alias: "cake",
};

const location: PublicLocationRow = {
  id: locationId,
  market_id: marketId,
  slug: "shendam-road",
  name: "Shendam Road",
  latitude: 8.4917,
  longitude: 8.5153,
  is_active: true,
};

const business: PublicBusinessRow = {
  id: businessId,
  market_id: marketId,
  location_id: locationId,
  slug: "lafia-bakes",
  name: "Lafia Bakes",
  metadata: {
    summary: "Made-to-order cakes.",
    capabilityTags: ["cake", "catering"],
    serviceAreas: ["Shendam Road"],
    color: "#336655",
  },
  status: "active",
};

const listing: PublicListingRow = {
  id: listingId,
  market_id: marketId,
  business_id: businessId,
  category_id: categoryId,
  location_id: locationId,
  slug: "birthday-cakes",
  title: "Birthday cakes",
  description: "Made after an order is confirmed.",
  attributes: {
    capabilityTags: ["cake", "birthday-cake"],
    serviceAreas: ["Shendam Road"],
    availabilityWindows: ["tomorrow", "on-request"],
  },
  is_orderable: true,
  price_minor: 1_250_000,
  currency_code: "NGN",
  published_at: "2026-08-29T08:00:00.000Z",
  status: "active",
  has_active_variant: false,
};

function rows(overrides: Partial<PublicCatalogRows> = {}): PublicCatalogRows {
  return {
    market,
    categories: [category],
    aliases: [alias],
    locations: [location],
    businesses: [business],
    listings: [listing],
    ...overrides,
  };
}

function queryResult<T>(result: T) {
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    not: vi.fn(() => query),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    select: vi.fn(() => query),
    then: (
      onFulfilled: (value: T) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.mockResolvedValue(undefined);
  mocks.getConfig.mockReturnValue({
    url: "https://project.supabase.co",
    anonKey: "public-publishable-key",
  });
});

describe("public catalog provider boundary", () => {
  it("imports no privileged client and creates a stateless publishable-key client", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "lib/catalog/public-catalog.ts"),
      "utf8",
    );
    expect(source).not.toContain("@/lib/supabase/admin");
    expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(source).not.toContain("getServerSupabaseClient");

    const marketQuery = queryResult({
      data: null,
      error: { message: "network unavailable" },
    });
    mocks.createClient.mockReturnValue({ from: () => marketQuery });

    await expect(getPublicCatalog("lafia")).resolves.toMatchObject({
      state: "unavailable",
      source: "supabase",
    });
    expect(mocks.connection).toHaveBeenCalledBefore(mocks.getConfig);
    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "public-publishable-key",
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
  });

  it("distinguishes absent config, an unpublished market, and provider failure", async () => {
    mocks.getConfig.mockReturnValueOnce(null);
    await expect(getPublicCatalog("lafia")).resolves.toEqual({
      state: "not-configured",
      source: "supabase",
      complete: false,
      market: undefined,
      categories: [],
      locations: [],
      vendors: [],
      listings: [],
    });

    const missingMarketQuery = queryResult({ data: null, error: null });
    mocks.createClient.mockReturnValueOnce({ from: () => missingMarketQuery });
    await expect(getPublicCatalog("lafia")).resolves.toMatchObject({
      state: "market-unpublished",
    });

    const failedMarketQuery = queryResult({
      data: null,
      error: { message: "timeout" },
    });
    mocks.createClient.mockReturnValueOnce({ from: () => failedMarketQuery });
    await expect(getPublicCatalog("lafia")).resolves.toMatchObject({
      state: "unavailable",
    });
  });

  it("returns ready with truthful empty arrays for a configured empty market", async () => {
    const tableQueries = {
      markets: queryResult({ data: market, error: null }),
      categories: queryResult({ data: [], error: null }),
      market_locations: queryResult({ data: [], error: null }),
    };
    const from = vi.fn(
      (table: keyof typeof tableQueries) => tableQueries[table],
    );
    const rpc = vi.fn(() => queryResult({ data: [], error: null }));
    mocks.createClient.mockReturnValue({ from, rpc });

    await expect(getPublicCatalog("lafia")).resolves.toEqual({
      state: "ready",
      source: "supabase",
      complete: true,
      market: {
        id: marketId,
        slug: "lafia",
        name: "Lafia",
        countryCode: "NG",
        currencyCode: "NGN",
        timezone: "Africa/Lagos",
      },
      categories: [],
      locations: [],
      vendors: [],
      listings: [],
    });
    expect(from).not.toHaveBeenCalledWith("category_aliases");
    expect(from).not.toHaveBeenCalledWith("businesses");
    expect(from).not.toHaveBeenCalledWith("listings");
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("list_public_catalog_businesses", {
      p_market_id: marketId,
      p_limit: 250,
    });
  });

  it("loads a populated market with bounded batch queries and explicit visibility filters", async () => {
    const tableQueries = {
      markets: queryResult({ data: market, error: null }),
      categories: queryResult({ data: [category], error: null }),
      market_locations: queryResult({ data: [location], error: null }),
      category_aliases: queryResult({ data: [alias], error: null }),
    };
    const rpcQueries = {
      list_public_catalog_businesses: queryResult({
        data: [business],
        error: null,
      }),
      list_public_catalog_listings: queryResult({
        data: [listing],
        error: null,
      }),
    };
    const from = vi.fn(
      (table: keyof typeof tableQueries) => tableQueries[table],
    );
    const rpc = vi.fn((name: keyof typeof rpcQueries) => rpcQueries[name]);
    mocks.createClient.mockReturnValue({ from, rpc });

    const snapshot = await getPublicCatalog("lafia");

    expect(snapshot.state).toBe("ready");
    expect(snapshot.listings).toHaveLength(1);
    expect(from.mock.calls.map(([table]) => table)).toEqual([
      "markets",
      "categories",
      "market_locations",
      "category_aliases",
    ]);
    expect(from).not.toHaveBeenCalledWith("businesses");
    expect(from).not.toHaveBeenCalledWith("listings");
    expect(tableQueries.markets.eq).toHaveBeenCalledWith("slug", "lafia");
    expect(tableQueries.markets.eq).toHaveBeenCalledWith("is_active", true);
    expect(tableQueries.markets.limit).toHaveBeenCalledWith(1);
    expect(tableQueries.categories.eq).toHaveBeenCalledWith("is_active", true);
    expect(tableQueries.categories.or).toHaveBeenCalledWith(
      `market_id.is.null,market_id.eq.${marketId}`,
    );
    expect(tableQueries.categories.limit).toHaveBeenCalledWith(200);
    expect(tableQueries.categories.order.mock.calls).toEqual([
      ["name", { ascending: true }],
      ["id", { ascending: true }],
    ]);
    expect(tableQueries.market_locations.eq).toHaveBeenCalledWith(
      "market_id",
      marketId,
    );
    expect(tableQueries.market_locations.eq).toHaveBeenCalledWith(
      "is_active",
      true,
    );
    expect(tableQueries.market_locations.limit).toHaveBeenCalledWith(250);
    expect(tableQueries.market_locations.order.mock.calls).toEqual([
      ["name", { ascending: true }],
      ["id", { ascending: true }],
    ]);
    expect(tableQueries.category_aliases.in).toHaveBeenCalledWith(
      "category_id",
      [categoryId],
    );
    expect(tableQueries.category_aliases.limit).toHaveBeenCalledWith(500);
    expect(tableQueries.category_aliases.order.mock.calls).toEqual([
      ["alias", { ascending: true }],
      ["id", { ascending: true }],
    ]);
    expect(rpc.mock.calls).toEqual([
      [
        "list_public_catalog_businesses",
        { p_market_id: marketId, p_limit: 250 },
      ],
      ["list_public_catalog_listings", { p_market_id: marketId, p_limit: 500 }],
    ]);
  });

  it("fails closed when either public projection RPC fails", async () => {
    const tableQueries = {
      markets: queryResult({ data: market, error: null }),
      categories: queryResult({ data: [category], error: null }),
      market_locations: queryResult({ data: [location], error: null }),
      category_aliases: queryResult({ data: [alias], error: null }),
    };
    const from = vi.fn(
      (table: keyof typeof tableQueries) => tableQueries[table],
    );
    const failedBusinessesRpc = vi.fn(() =>
      queryResult({ data: null, error: { message: "projection unavailable" } }),
    );
    mocks.createClient.mockReturnValueOnce({
      from,
      rpc: failedBusinessesRpc,
    });

    await expect(getPublicCatalog("lafia")).resolves.toMatchObject({
      state: "unavailable",
    });
    expect(failedBusinessesRpc).toHaveBeenCalledOnce();

    const rpcQueries = {
      list_public_catalog_businesses: queryResult({
        data: [business],
        error: null,
      }),
      list_public_catalog_listings: queryResult({
        data: null,
        error: { message: "projection unavailable" },
      }),
    };
    const failedListingsRpc = vi.fn(
      (name: keyof typeof rpcQueries) => rpcQueries[name],
    );
    mocks.createClient.mockReturnValueOnce({ from, rpc: failedListingsRpc });

    await expect(getPublicCatalog("lafia")).resolves.toMatchObject({
      state: "unavailable",
    });
    expect(failedListingsRpc).toHaveBeenCalledTimes(2);
  });
});

describe("public catalog mapping", () => {
  it("preserves live identifiers, slugs, price, currency, and location", () => {
    const mapped = mapPublicCatalogRows(rows());

    expect(mapped?.market.id).toBe(marketId);
    expect(mapped?.categories[0]).toMatchObject({
      id: categoryId,
      marketId,
      slug: "food-restaurants",
      routeKey: `food-restaurants~${categoryId}`,
      aliases: ["Food & restaurants", "food restaurants", "cake"],
    });
    expect(mapped?.vendors[0]).toMatchObject({
      id: businessId,
      marketId,
      locationId,
      slug: "lafia-bakes",
      location: "Shendam Road",
      coordinates: { latitude: 8.4917, longitude: 8.5153 },
      provenance: {
        kind: "live",
        source: "supabase",
        verifiedBusiness: false,
      },
    });
    expect(mapped?.listings[0]).toMatchObject({
      id: listingId,
      marketId,
      businessId,
      categoryId,
      locationId,
      slug: "birthday-cakes",
      routeKey: "lafia-bakes~birthday-cakes",
      vendor: "lafia-bakes",
      category: "food-restaurants",
      location: "Shendam Road",
      isOrderable: true,
      currencyCode: "NGN",
      priceMinor: 1_250_000,
      priceRangeNaira: { min: 12_500, max: 12_500 },
      provenance: {
        kind: "live",
        source: "supabase",
        verifiedBusiness: false,
      },
    });
    expect(mapped?.listings[0].provenance.kind).not.toBe("fictional-demo");
  });

  it("aligns public ordering with the deterministic base-order prerequisites", () => {
    const disabled = mapPublicCatalogRows(
      rows({ listings: [{ ...listing, is_orderable: false }] }),
    );
    const missingPrice = mapPublicCatalogRows(
      rows({
        listings: [
          {
            ...listing,
            is_orderable: true,
            price_minor: null,
          },
        ],
      }),
    );
    const zeroPrice = mapPublicCatalogRows(
      rows({ listings: [{ ...listing, price_minor: 0 }] }),
    );
    const foreignCurrency = mapPublicCatalogRows(
      rows({ listings: [{ ...listing, currency_code: "USD" }] }),
    );
    const missingCategory = mapPublicCatalogRows(
      rows({ listings: [{ ...listing, category_id: null }] }),
    );
    const activeVariant = mapPublicCatalogRows(
      rows({
        listings: [
          {
            ...listing,
            has_active_variant: true,
          },
        ],
      }),
    );
    const malformedVariantSignal = mapPublicCatalogRows(
      rows({
        listings: [
          {
            ...listing,
            has_active_variant: undefined,
          } as unknown as PublicListingRow,
        ],
      }),
    );

    expect(disabled?.listings[0].isOrderable).toBe(false);
    expect(missingPrice?.listings[0].isOrderable).toBe(false);
    expect(zeroPrice?.listings[0].isOrderable).toBe(false);
    expect(foreignCurrency?.listings[0].isOrderable).toBe(false);
    expect(missingCategory?.listings).toEqual([]);
    expect(activeVariant?.listings[0].isOrderable).toBe(false);
    expect(malformedVariantSignal?.listings[0].isOrderable).toBe(false);
  });

  it("cannot surface inactive or route-unsafe catalog records", () => {
    const hiddenCategory = {
      ...category,
      id: "73333333-3333-4333-8333-333333333333",
      is_active: false,
    };
    const hiddenLocation = {
      ...location,
      id: "74444444-4444-4444-8444-444444444444",
      is_active: false,
    };
    const hiddenBusiness = {
      ...business,
      id: "75555555-5555-4555-8555-555555555555",
      slug: "hidden-business",
      status: "suspended",
    };
    const draftListing = {
      ...listing,
      id: "76666666-6666-4666-8666-666666666666",
      slug: "draft-listing",
      status: "draft" as const,
    };
    const unpublishedListing = {
      ...listing,
      id: "86666666-6666-4666-8666-666666666666",
      slug: "unpublished-listing",
      published_at: null,
    };
    const hiddenBusinessListing = {
      ...listing,
      id: "96666666-6666-4666-8666-666666666666",
      business_id: hiddenBusiness.id,
      slug: "hidden-business-listing",
    };
    const hiddenCategoryListing = {
      ...listing,
      id: "97666666-6666-4666-8666-666666666666",
      category_id: hiddenCategory.id,
      slug: "hidden-category-listing",
    };
    const crossMarketBusiness = {
      ...business,
      id: "a5555555-5555-4555-8555-555555555555",
      market_id: otherMarketId,
      slug: "other-market-business",
    };
    const unsafeCategory = {
      ...category,
      id: "b3333333-3333-4333-8333-333333333333",
      slug: "unsafe/category",
    };
    const unsafeLocation = {
      ...location,
      id: "b4444444-4444-4444-8444-444444444444",
      slug: "Unsafe Location",
    };
    const unsafeBusiness = {
      ...business,
      id: "b5555555-5555-4555-8555-555555555555",
      slug: "unsafe~business",
    };
    const unsafeListing = {
      ...listing,
      id: "b6666666-6666-4666-8666-666666666666",
      slug: "unsafe/listing",
    };
    const unsafeBusinessListing = {
      ...listing,
      id: "c6666666-6666-4666-8666-666666666666",
      business_id: unsafeBusiness.id,
      slug: "otherwise-safe-listing",
    };

    const mapped = mapPublicCatalogRows(
      rows({
        categories: [category, hiddenCategory, unsafeCategory],
        locations: [location, hiddenLocation, unsafeLocation],
        businesses: [
          business,
          hiddenBusiness,
          crossMarketBusiness,
          unsafeBusiness,
        ],
        listings: [
          listing,
          draftListing,
          unpublishedListing,
          hiddenBusinessListing,
          hiddenCategoryListing,
          unsafeListing,
          unsafeBusinessListing,
        ],
      }),
    );

    expect(mapped?.categories.map(({ id }) => id)).toEqual([categoryId]);
    expect(mapped?.locations.map(({ id }) => id)).toEqual([locationId]);
    expect(mapped?.vendors.map(({ id }) => id)).toEqual([businessId]);
    expect(mapped?.listings.map(({ id }) => id)).toEqual([listingId]);
  });

  it("rejects a route-unsafe market before exposing child records", () => {
    expect(
      mapPublicCatalogRows(
        rows({ market: { ...market, slug: "unsafe/market" } }),
      ),
    ).toBeNull();
  });

  it("ignores malformed JSON instead of crashing or creating public claims", () => {
    expect(parsePublicListingAttributes("not-an-object")).toEqual({
      availabilityNote: undefined,
      availabilityWindows: [],
      capabilityTags: [],
      color: undefined,
      priceNote: undefined,
      serviceAreas: [],
    });

    const malformedListing: PublicListingRow = {
      ...listing,
      attributes: {
        availabilityWindows: ["always", 42, { label: "tomorrow" }],
        capabilityTags: "best-in-town",
        color: "green",
        priceNote: { claim: "cheap" },
        serviceAreas: { area: "Everywhere" },
      },
      currency_code: "invalid",
      price_minor: -1,
    };
    const malformedBusiness: PublicBusinessRow = {
      ...business,
      metadata: {
        capabilityTags: "best-vendor",
        color: "green",
        serviceAreas: { all: true },
        summary: ["Unverified claim"],
      },
    };

    const mapped = mapPublicCatalogRows(
      rows({ businesses: [malformedBusiness], listings: [malformedListing] }),
    );

    expect(mapped?.vendors[0]).toMatchObject({
      capabilityTags: [],
      serviceAreas: [],
      summary: "",
    });
    expect(mapped?.listings[0]).toMatchObject({
      capabilityTags: [],
      serviceAreas: [],
      availabilityWindows: [],
      isOrderable: false,
    });
    expect(mapped?.listings[0].currencyCode).toBeUndefined();
    expect(mapped?.listings[0].priceMinor).toBeUndefined();
    expect(mapped?.listings[0].priceRangeNaira).toBeUndefined();
    expect(mapped?.listings[0].priceNote).toBeUndefined();
  });

  it("maps only allowlisted projection JSON and does not fall back to a source address", () => {
    const projectedBusiness: PublicBusinessRow = {
      ...business,
      location_id: null,
      metadata: {
        summary: "Public summary",
        serviceAreas: ["Lafia"],
        privatePhone: "+2348000000000",
        legalName: "Private Legal Name Ltd",
      },
    };
    const projectedListing: PublicListingRow = {
      ...listing,
      location_id: null,
      attributes: {
        capabilityTags: ["cake"],
        internalCostMinor: 400_000,
        supplierNote: "private supplier note",
      },
    };

    const mapped = mapPublicCatalogRows(
      rows({
        businesses: [projectedBusiness],
        listings: [projectedListing],
      }),
    );
    const serialized = JSON.stringify(mapped);

    expect(mapped?.vendors[0]).toMatchObject({
      location: "",
      summary: "Public summary",
      serviceAreas: ["Lafia"],
    });
    expect(mapped?.listings[0]).toMatchObject({ capabilityTags: ["cake"] });
    expect(serialized).not.toContain("+2348000000000");
    expect(serialized).not.toContain("Private Legal Name Ltd");
    expect(serialized).not.toContain("private supplier note");
    expect(serialized).not.toContain("400000");
  });
});
