import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { cache } from "react";

import {
  LIVE_SUPABASE_PROVENANCE,
  type AvailabilityWindow,
  type CatalogState,
  type CatalogLocation,
  type Category,
  type Listing,
  type Vendor,
} from "@/lib/catalog/data";
import { getPublicSupabaseConfig } from "@/lib/config/env";
import type { Database, Json } from "@/lib/supabase/database.types";

const PUBLIC_CATALOG_LIMITS = Object.freeze({
  categories: 200,
  aliases: 500,
  locations: 250,
  vendors: 250,
  listings: 500,
});

export type PublicCatalogCounts = {
  categories: number;
  aliases: number;
  locations: number;
  vendors: number;
  listings: number;
};

/** Equality is conservatively incomplete because every source query is capped. */
export function hasCompletePublicCatalogCoverage(
  counts: PublicCatalogCounts,
): boolean {
  return (
    counts.categories < PUBLIC_CATALOG_LIMITS.categories &&
    counts.aliases < PUBLIC_CATALOG_LIMITS.aliases &&
    counts.locations < PUBLIC_CATALOG_LIMITS.locations &&
    counts.vendors < PUBLIC_CATALOG_LIMITS.vendors &&
    counts.listings < PUBLIC_CATALOG_LIMITS.listings
  );
}

const PUBLIC_CATALOG_ACCENT = "#315c49";
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const AVAILABILITY_WINDOWS = new Set<AvailabilityWindow>([
  "today",
  "tonight",
  "tomorrow",
  "saturday",
  "next-saturday",
  "weekend",
  "on-request",
]);

type TableRow<Name extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][Name]["Row"];

export type PublicMarketRow = Pick<
  TableRow<"markets">,
  | "id"
  | "slug"
  | "name"
  | "country_code"
  | "currency_code"
  | "timezone"
  | "is_active"
>;

export type PublicCategoryRow = Pick<
  TableRow<"categories">,
  "id" | "market_id" | "slug" | "name" | "is_active"
>;

export type PublicCategoryAliasRow = Pick<
  TableRow<"category_aliases">,
  "id" | "category_id" | "market_id" | "alias"
>;

export type PublicLocationRow = Pick<
  TableRow<"market_locations">,
  "id" | "market_id" | "slug" | "name" | "latitude" | "longitude" | "is_active"
>;

export type PublicBusinessRow = Pick<
  TableRow<"businesses">,
  | "id"
  | "market_id"
  | "location_id"
  | "slug"
  | "name"
  | "address_text"
  | "metadata"
  | "status"
>;

export type PublicListingRow = Pick<
  TableRow<"listings">,
  | "id"
  | "market_id"
  | "business_id"
  | "category_id"
  | "location_id"
  | "slug"
  | "title"
  | "description"
  | "attributes"
  | "is_orderable"
  | "price_minor"
  | "currency_code"
  | "published_at"
  | "status"
> & {
  listing_variants: readonly Pick<
    TableRow<"listing_variants">,
    "id" | "is_active"
  >[];
};

export type PublicCatalogMarket = {
  id: string;
  slug: string;
  name: string;
  countryCode: string;
  currencyCode: string;
  timezone: string;
};

export type PublicCatalogState = CatalogState;

export type PublicCatalogSnapshot = {
  state: PublicCatalogState;
  source: "supabase";
  complete: boolean;
  market?: PublicCatalogMarket;
  categories: Category[];
  locations: CatalogLocation[];
  vendors: Vendor[];
  listings: Listing[];
};

export type PublicCatalogRows = {
  market: PublicMarketRow;
  categories: readonly PublicCategoryRow[];
  aliases: readonly PublicCategoryAliasRow[];
  locations: readonly PublicLocationRow[];
  businesses: readonly PublicBusinessRow[];
  listings: readonly PublicListingRow[];
};

export type MappedPublicCatalog = {
  market: PublicCatalogMarket;
  categories: Category[];
  locations: CatalogLocation[];
  vendors: Vendor[];
  listings: Listing[];
};

type PublicListingAttributes = {
  availabilityNote?: string;
  availabilityWindows: AvailabilityWindow[];
  capabilityTags: string[];
  color?: string;
  priceNote?: string;
  serviceAreas: string[];
};

type PublicBusinessMetadata = {
  capabilityTags: string[];
  color?: string;
  serviceAreas: string[];
  summary?: string;
};

const EMPTY_SNAPSHOT = Object.freeze({
  source: "supabase" as const,
  complete: false,
  market: undefined,
  categories: [] as Category[],
  locations: [] as CatalogLocation[],
  vendors: [] as Vendor[],
  listings: [] as Listing[],
});

function emptySnapshot(state: Exclude<PublicCatalogState, "ready">) {
  return { ...EMPTY_SNAPSHOT, state } satisfies PublicCatalogSnapshot;
}

function asRecord(value: Json): Record<string, Json | undefined> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function boundedText(value: Json | undefined, maximumLength: number) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= maximumLength ? text : undefined;
}

function boundedTextArray(
  value: Json | undefined,
  maximumItems: number,
  maximumLength: number,
) {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of value) {
    const text = boundedText(item, maximumLength);
    const normalized = text?.toLocaleLowerCase("en");
    if (!text || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(text);
    if (values.length === maximumItems) break;
  }
  return values;
}

function firstJsonValue(
  record: Record<string, Json | undefined> | null,
  ...keys: string[]
) {
  if (!record) return undefined;
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

/** Parse only public, presentation-safe listing fields from vendor JSON. */
export function parsePublicListingAttributes(
  value: Json,
): PublicListingAttributes {
  const attributes = asRecord(value);
  const availabilityWindows = boundedTextArray(
    firstJsonValue(attributes, "availabilityWindows", "availability_windows"),
    AVAILABILITY_WINDOWS.size,
    32,
  ).filter((window): window is AvailabilityWindow =>
    AVAILABILITY_WINDOWS.has(window as AvailabilityWindow),
  );
  const color = boundedText(firstJsonValue(attributes, "color"), 7);

  return {
    availabilityNote: boundedText(
      firstJsonValue(attributes, "availabilityNote", "availability_note"),
      240,
    ),
    availabilityWindows,
    capabilityTags: boundedTextArray(
      firstJsonValue(attributes, "capabilityTags", "capability_tags"),
      24,
      64,
    ),
    color: color && COLOR_PATTERN.test(color) ? color : undefined,
    priceNote: boundedText(
      firstJsonValue(attributes, "priceNote", "price_note"),
      240,
    ),
    serviceAreas: boundedTextArray(
      firstJsonValue(attributes, "serviceAreas", "service_areas"),
      24,
      96,
    ),
  };
}

function parsePublicBusinessMetadata(value: Json): PublicBusinessMetadata {
  const metadata = asRecord(value);
  const color = boundedText(firstJsonValue(metadata, "color"), 7);

  return {
    capabilityTags: boundedTextArray(
      firstJsonValue(metadata, "capabilityTags", "capability_tags"),
      24,
      64,
    ),
    color: color && COLOR_PATTERN.test(color) ? color : undefined,
    serviceAreas: boundedTextArray(
      firstJsonValue(metadata, "serviceAreas", "service_areas"),
      24,
      96,
    ),
    summary: boundedText(firstJsonValue(metadata, "summary"), 500),
  };
}

function validCoordinates(row: PublicLocationRow) {
  const { latitude, longitude } = row;
  if (
    latitude === null ||
    longitude === null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return undefined;
  }
  return { latitude, longitude };
}

function validCurrency(value: string) {
  const normalized = value.trim().toUpperCase();
  return CURRENCY_PATTERN.test(normalized) ? normalized : undefined;
}

function validPriceMinor(value: number | null) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function firstCategoryForBusiness(
  businessId: string,
  listings: readonly PublicListingRow[],
  categoryById: ReadonlyMap<string, Category>,
) {
  for (const listing of listings) {
    if (listing.business_id !== businessId || !listing.category_id) continue;
    const category = categoryById.get(listing.category_id);
    if (category) return category.slug;
  }
  return "";
}

function categoryAliases(
  category: PublicCategoryRow,
  storedAliases: readonly string[],
) {
  const humanizedSlug = category.slug.replaceAll("-", " ").trim();
  const aliases = [category.name.trim(), humanizedSlug, ...storedAliases];
  const seen = new Set<string>();
  return aliases.filter((alias) => {
    const normalized = alias.toLocaleLowerCase("en");
    if (!alias || alias.length > 96 || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

/**
 * Convert bounded database rows into the public view model. This mapper remains
 * defensive even though the database queries and RLS apply the same boundary.
 */
export function mapPublicCatalogRows(
  rows: PublicCatalogRows,
): MappedPublicCatalog | null {
  if (!rows.market.is_active || !SLUG_PATTERN.test(rows.market.slug)) {
    return null;
  }

  const market: PublicCatalogMarket = {
    id: rows.market.id,
    slug: rows.market.slug,
    name: rows.market.name,
    countryCode: rows.market.country_code,
    currencyCode: rows.market.currency_code,
    timezone: rows.market.timezone,
  };

  const activeCategories = rows.categories.filter(
    (category) =>
      category.is_active &&
      SLUG_PATTERN.test(category.slug) &&
      (category.market_id === null || category.market_id === market.id),
  );
  const activeCategoryIds = new Set(
    activeCategories.map((category) => category.id),
  );
  const activeCategoryRowsById = new Map(
    activeCategories.map((category) => [category.id, category]),
  );
  const aliasesByCategory = new Map<string, string[]>();
  for (const alias of rows.aliases) {
    const aliasCategory = activeCategoryRowsById.get(alias.category_id);
    if (
      !aliasCategory ||
      alias.market_id !== aliasCategory.market_id ||
      !activeCategoryIds.has(alias.category_id)
    ) {
      continue;
    }
    const text = alias.alias.trim();
    if (!text || text.length > 96) continue;
    const aliases = aliasesByCategory.get(alias.category_id) ?? [];
    if (
      !aliases.some((existing) => existing.toLowerCase() === text.toLowerCase())
    ) {
      aliases.push(text);
      aliasesByCategory.set(alias.category_id, aliases);
    }
  }

  const categories: Category[] = activeCategories.map((category) => ({
    id: category.id,
    marketId: category.market_id,
    slug: category.slug,
    routeKey: `${category.slug}~${category.id}`,
    name: category.name,
    aliases: categoryAliases(
      category,
      aliasesByCategory.get(category.id) ?? [],
    ),
    description: "",
  }));
  const categoryById = new Map(
    categories.flatMap((category) =>
      category.id ? ([[category.id, category]] as const) : [],
    ),
  );

  const activeLocationRows = rows.locations.filter(
    (location) =>
      location.is_active &&
      SLUG_PATTERN.test(location.slug) &&
      location.market_id === market.id,
  );
  const locations: CatalogLocation[] = activeLocationRows.map((location) => ({
    id: location.id,
    slug: location.slug,
    name: location.name,
    coordinates: validCoordinates(location),
  }));
  const locationById = new Map(
    locations.flatMap((location) =>
      location.id ? ([[location.id, location]] as const) : [],
    ),
  );

  const activeBusinesses = rows.businesses.filter(
    (business) =>
      business.status === "active" &&
      SLUG_PATTERN.test(business.slug) &&
      business.market_id === market.id,
  );
  const activeBusinessIds = new Set(
    activeBusinesses.map((business) => business.id),
  );
  const publicListingRows = rows.listings.filter(
    (listing) =>
      listing.status === "active" &&
      listing.published_at !== null &&
      SLUG_PATTERN.test(listing.slug) &&
      listing.market_id === market.id &&
      activeBusinessIds.has(listing.business_id),
  );

  const vendors: Vendor[] = activeBusinesses.map((business) => {
    const metadata = parsePublicBusinessMetadata(business.metadata);
    const location = business.location_id
      ? locationById.get(business.location_id)
      : undefined;
    return {
      id: business.id,
      marketId: business.market_id,
      locationId: business.location_id,
      slug: business.slug,
      name: business.name,
      category: firstCategoryForBusiness(
        business.id,
        publicListingRows,
        categoryById,
      ),
      location: location?.name ?? business.address_text?.trim() ?? "",
      coordinates: location?.coordinates,
      serviceAreas: metadata.serviceAreas,
      capabilityTags: metadata.capabilityTags,
      summary: metadata.summary ?? "",
      color: metadata.color ?? PUBLIC_CATALOG_ACCENT,
      provenance: LIVE_SUPABASE_PROVENANCE,
    };
  });
  const vendorById = new Map(
    vendors.flatMap((vendor) =>
      vendor.id ? ([[vendor.id, vendor]] as const) : [],
    ),
  );

  const listings: Listing[] = publicListingRows.flatMap((listing) => {
    const vendor = vendorById.get(listing.business_id);
    if (!vendor) return [];
    const category = listing.category_id
      ? categoryById.get(listing.category_id)
      : undefined;
    const location =
      (listing.location_id
        ? locationById.get(listing.location_id)
        : undefined) ?? businessLocation(vendor, locationById);
    const attributes = parsePublicListingAttributes(listing.attributes);
    const currencyCode = validCurrency(listing.currency_code);
    const priceMinor = validPriceMinor(listing.price_minor);
    const isOrderable =
      listing.is_orderable === true &&
      category !== undefined &&
      currencyCode === market.currencyCode &&
      priceMinor !== undefined &&
      priceMinor > 0 &&
      !listing.listing_variants.some((variant) => variant.is_active);
    const priceRangeNaira =
      currencyCode === "NGN" && priceMinor !== undefined
        ? { min: priceMinor / 100, max: priceMinor / 100 }
        : undefined;

    return [
      {
        id: listing.id,
        marketId: listing.market_id,
        businessId: listing.business_id,
        categoryId: listing.category_id,
        locationId: listing.location_id,
        slug: listing.slug,
        routeKey: `${vendor.slug}~${listing.slug}`,
        vendor: vendor.slug,
        title: listing.title,
        category: category?.slug ?? "",
        location: location?.name ?? vendor.location,
        coordinates: location?.coordinates ?? vendor.coordinates,
        serviceAreas: attributes.serviceAreas,
        capabilityTags: attributes.capabilityTags,
        availabilityWindows: attributes.availabilityWindows,
        description: listing.description?.trim() ?? "",
        isOrderable,
        currencyCode,
        priceMinor,
        priceRangeNaira,
        priceNote: attributes.priceNote,
        availabilityNote: attributes.availabilityNote,
        color: attributes.color ?? vendor.color,
        provenance: LIVE_SUPABASE_PROVENANCE,
      } satisfies Listing,
    ];
  });

  return { market, categories, locations, vendors, listings };
}

function businessLocation(
  vendor: Vendor,
  locationById: ReadonlyMap<string, CatalogLocation>,
) {
  return vendor.locationId ? locationById.get(vendor.locationId) : undefined;
}

function createAnonymousCatalogClient(
  url: string,
  publishableKey: string,
): SupabaseClient<Database> {
  return createClient<Database>(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

/** Load one public market snapshot through the anonymous RLS boundary. */
async function loadPublicCatalog(
  marketSlug: string,
): Promise<PublicCatalogSnapshot> {
  await connection();

  const config = getPublicSupabaseConfig();
  if (!config) return emptySnapshot("not-configured");

  const normalizedSlug = marketSlug.trim().toLowerCase();
  if (
    normalizedSlug.length === 0 ||
    normalizedSlug.length > 80 ||
    !SLUG_PATTERN.test(normalizedSlug)
  ) {
    return emptySnapshot("market-unpublished");
  }

  try {
    const client = createAnonymousCatalogClient(config.url, config.anonKey);
    const marketResult = await client
      .from("markets")
      .select("id,slug,name,country_code,currency_code,timezone,is_active")
      .eq("slug", normalizedSlug)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (marketResult.error) return emptySnapshot("unavailable");
    if (!marketResult.data) return emptySnapshot("market-unpublished");
    const market = marketResult.data;

    const [categoryResult, locationResult, businessResult] = await Promise.all([
      client
        .from("categories")
        .select("id,market_id,slug,name,is_active")
        .eq("is_active", true)
        .or(`market_id.is.null,market_id.eq.${market.id}`)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .limit(PUBLIC_CATALOG_LIMITS.categories),
      client
        .from("market_locations")
        .select("id,market_id,slug,name,latitude,longitude,is_active")
        .eq("market_id", market.id)
        .eq("is_active", true)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .limit(PUBLIC_CATALOG_LIMITS.locations),
      client
        .from("businesses")
        .select(
          "id,market_id,location_id,slug,name,address_text,metadata,status",
        )
        .eq("market_id", market.id)
        .eq("status", "active")
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .limit(PUBLIC_CATALOG_LIMITS.vendors),
    ]);

    if (categoryResult.error || locationResult.error || businessResult.error) {
      return emptySnapshot("unavailable");
    }

    const categoryRows = categoryResult.data ?? [];
    const businessRows = businessResult.data ?? [];
    const categoryIds = categoryRows.map((category) => category.id);
    const businessIds = businessRows.map((business) => business.id);

    const [aliasResult, listingResult] = await Promise.all([
      categoryIds.length > 0
        ? client
            .from("category_aliases")
            .select("id,category_id,market_id,alias")
            .in("category_id", categoryIds)
            .or(`market_id.is.null,market_id.eq.${market.id}`)
            .order("alias", { ascending: true })
            .order("id", { ascending: true })
            .limit(PUBLIC_CATALOG_LIMITS.aliases)
        : Promise.resolve({ data: [], error: null }),
      businessIds.length > 0
        ? client
            .from("listings")
            .select(
              "id,market_id,business_id,category_id,location_id,slug,title,description,attributes,is_orderable,price_minor,currency_code,published_at,status,listing_variants(id,is_active)",
            )
            .eq("market_id", market.id)
            .eq("status", "active")
            .not("published_at", "is", null)
            .in("business_id", businessIds)
            .eq("listing_variants.is_active", true)
            .order("published_at", { ascending: false })
            .order("id", { ascending: true })
            .limit(1, { referencedTable: "listing_variants" })
            .limit(PUBLIC_CATALOG_LIMITS.listings)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (aliasResult.error || listingResult.error) {
      return emptySnapshot("unavailable");
    }

    const aliasRows = aliasResult.data ?? [];
    const listingRows = listingResult.data ?? [];
    const mapped = mapPublicCatalogRows({
      market,
      categories: categoryRows,
      aliases: aliasRows,
      locations: locationResult.data ?? [],
      businesses: businessRows,
      listings: listingRows,
    });
    if (!mapped) return emptySnapshot("market-unpublished");

    const complete = hasCompletePublicCatalogCoverage({
      categories: categoryRows.length,
      aliases: aliasRows.length,
      locations: (locationResult.data ?? []).length,
      vendors: businessRows.length,
      listings: listingRows.length,
    });

    return { state: "ready", source: "supabase", complete, ...mapped };
  } catch {
    return emptySnapshot("unavailable");
  }
}

export const getPublicCatalog = cache(loadPublicCatalog);
