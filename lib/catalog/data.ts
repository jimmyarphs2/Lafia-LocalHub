import { getDemoArea } from "@/lib/location/lafia";
import type { GeoPoint } from "@/lib/location/haversine";

export type Category = {
  id?: string;
  marketId?: string | null;
  slug: string;
  routeKey?: string;
  name: string;
  aliases: readonly string[];
  description: string;
};

export type DemoProvenance = {
  kind: "fictional-demo";
  source: "localhub-seed";
  verifiedBusiness: false;
  notice: string;
};

export type LiveProvenance = {
  kind: "live";
  source: "supabase";
  verifiedBusiness: false;
};

export type CatalogProvenance = DemoProvenance | LiveProvenance;

export type CatalogLocation = {
  id?: string;
  slug: string;
  name: string;
  coordinates?: GeoPoint;
};

export type CatalogState =
  "ready" | "not-configured" | "unavailable" | "market-unpublished";

export type AvailabilityWindow =
  | "today"
  | "tonight"
  | "tomorrow"
  | "saturday"
  | "next-saturday"
  | "weekend"
  | "on-request";

export type NairaRange = { min: number; max: number };

export type Vendor = {
  id?: string;
  marketId?: string;
  locationId?: string | null;
  slug: string;
  name: string;
  category: string;
  location: string;
  coordinates?: GeoPoint;
  serviceAreas: readonly string[];
  capabilityTags: readonly string[];
  summary: string;
  color: string;
  provenance: CatalogProvenance;
};

export type Listing = {
  id?: string;
  marketId?: string;
  businessId?: string;
  categoryId?: string | null;
  locationId?: string | null;
  slug: string;
  routeKey?: string;
  vendor: string;
  title: string;
  category: string;
  location: string;
  coordinates?: GeoPoint;
  serviceAreas: readonly string[];
  capabilityTags: readonly string[];
  availabilityWindows: readonly AvailabilityWindow[];
  description: string;
  isOrderable: boolean;
  currencyCode?: string;
  priceMinor?: number;
  priceRangeNaira?: NairaRange;
  priceNote?: string;
  availabilityNote?: string;
  color: string;
  provenance: CatalogProvenance;
};

export const FICTIONAL_DEMO_PROVENANCE = Object.freeze({
  kind: "fictional-demo",
  source: "localhub-seed",
  verifiedBusiness: false,
  notice:
    "Invented LocalHub test data. This is not a verified business, offer, price, location, rating, or availability claim.",
} satisfies DemoProvenance);

export const LIVE_SUPABASE_PROVENANCE = Object.freeze({
  kind: "live",
  source: "supabase",
  // Public catalog reads establish publication eligibility, not business KYC
  // or any other verification status. Keep this fail-closed until an
  // authoritative verification model and evidence contract exist.
  verifiedBusiness: false,
} satisfies LiveProvenance);

export const categories: readonly Category[] = [
  {
    slug: "food-restaurants",
    name: "Food & restaurants",
    aliases: [
      "food",
      "restaurant",
      "eat",
      "dinner",
      "cake",
      "bakery",
      "catering",
    ],
    description: "Meals, cakes and food service listings.",
  },
  {
    slug: "fashion",
    name: "Fashion",
    aliases: ["clothes", "clothing", "tailor", "dress", "wear"],
    description: "Clothing, tailoring and fashion listings.",
  },
  {
    slug: "electronics",
    name: "Electronics",
    aliases: ["phone", "laptop", "repair", "gadget", "charger", "screen"],
    description: "Device, accessory and repair listings.",
  },
  {
    slug: "beauty",
    name: "Beauty",
    aliases: ["hair", "makeup", "salon", "beauty"],
    description: "Beauty and personal care listings.",
  },
  {
    slug: "home-services",
    name: "Home services",
    aliases: ["plumber", "cleaning", "electrician", "home"],
    description: "Services for homes and everyday needs.",
  },
  {
    slug: "photography",
    name: "Photography",
    aliases: [
      "photographer",
      "photography",
      "photo",
      "camera",
      "introduction ceremony",
    ],
    description: "Photography and event media listings.",
  },
  {
    slug: "equipment-hire",
    name: "Equipment hire",
    aliases: ["generator", "generator hire", "equipment rental", "30kva"],
    description: "Equipment and temporary power hire listings.",
  },
  {
    slug: "hotels",
    name: "Hotels",
    aliases: ["hotel", "stay", "lodging", "accommodation"],
    description: "Hotel and short-stay listings.",
  },
  {
    slug: "health",
    name: "Health",
    aliases: ["health", "clinic", "pharmacy", "wellness"],
    description: "Health and wellness listings.",
  },
];

type DemoSeed = {
  vendorSlug: string;
  vendorName: string;
  listingSlug: string;
  title: string;
  category: string;
  area: string;
  extraAreas?: readonly string[];
  capabilities: readonly string[];
  availability: readonly AvailabilityWindow[];
  summary: string;
  description: string;
  color: string;
  price?: NairaRange;
};

const catalogSeeds: readonly DemoSeed[] = [
  {
    vendorSlug: "taste-of-lafia",
    vendorName: "Taste of Lafia (Demo)",
    listingSlug: "made-to-order-cakes",
    title: "Made-to-order birthday cakes",
    category: "food-restaurants",
    area: "shendam-road",
    capabilities: ["cake", "birthday-cake", "catering"],
    availability: ["tomorrow", "weekend", "on-request"],
    summary: "Fictional demo kitchen for celebration-cake enquiries.",
    description: "A fictional demo scenario for birthday-cake enquiries.",
    color: "#d9843f",
    price: { min: 8_000, max: 18_000 },
  },
  {
    vendorSlug: "shendam-crumb-demo",
    vendorName: "Shendam Crumb Studio (Demo)",
    listingSlug: "shendam-celebration-cakes",
    title: "Celebration cake enquiries",
    category: "food-restaurants",
    area: "shendam-road",
    capabilities: ["cake", "birthday-cake", "small-events"],
    availability: ["tomorrow", "saturday", "on-request"],
    summary: "Fictional demo bakery profile for made-to-order cakes.",
    description: "A fictional demo scenario for custom celebration cakes.",
    color: "#c77845",
    price: { min: 10_000, max: 20_000 },
  },
  {
    vendorSlug: "bukan-sidi-bakes-demo",
    vendorName: "Bukan Sidi Bakes (Demo)",
    listingSlug: "bukan-sidi-birthday-cakes",
    title: "Birthday cakes with delivery enquiry",
    category: "food-restaurants",
    area: "bukan-sidi",
    extraAreas: ["Shendam Road"],
    capabilities: ["cake", "birthday-cake", "delivery-enquiry"],
    availability: ["tomorrow", "weekend", "on-request"],
    summary: "Fictional demo baking profile for celebration enquiries.",
    description: "A fictional demo scenario for birthday-cake enquiries.",
    color: "#b76854",
    price: { min: 9_000, max: 19_500 },
  },
  {
    vendorSlug: "kabs-photography",
    vendorName: "Kabs Photography (Demo)",
    listingSlug: "event-photography",
    title: "Introduction ceremony photography",
    category: "photography",
    area: "lafia",
    capabilities: ["photography", "introduction-ceremony", "events"],
    availability: ["saturday", "next-saturday", "weekend", "on-request"],
    summary: "Fictional demo profile for event-photography enquiries.",
    description: "A fictional demo scenario for ceremony photography.",
    color: "#688c72",
    price: { min: 35_000, max: 70_000 },
  },
  {
    vendorSlug: "arewa-lens-demo",
    vendorName: "Arewa Lens Collective (Demo)",
    listingSlug: "family-event-photography",
    title: "Family event photography",
    category: "photography",
    area: "tudun-gwandara",
    capabilities: ["photography", "introduction-ceremony", "portraits"],
    availability: ["saturday", "next-saturday", "weekend", "on-request"],
    summary: "Fictional demo photography profile for family events.",
    description: "A fictional demo scenario for family-event photography.",
    color: "#557c7a",
    price: { min: 40_000, max: 75_000 },
  },
  {
    vendorSlug: "savannah-moments-demo",
    vendorName: "Savannah Moments (Demo)",
    listingSlug: "ceremony-photo-coverage",
    title: "Ceremony photo coverage",
    category: "photography",
    area: "jos-road",
    capabilities: ["photography", "introduction-ceremony", "events"],
    availability: ["saturday", "next-saturday", "weekend", "on-request"],
    summary: "Fictional demo photographer profile for ceremony enquiries.",
    description: "A fictional demo scenario for ceremony photo coverage.",
    color: "#64769b",
    price: { min: 45_000, max: 78_000 },
  },
  {
    vendorSlug: "blue-frame-demo",
    vendorName: "Blue Frame Stories (Demo)",
    listingSlug: "event-and-portrait-session",
    title: "Event and portrait session",
    category: "photography",
    area: "makurdi-road",
    capabilities: ["photography", "introduction-ceremony", "portraits"],
    availability: ["saturday", "next-saturday", "weekend", "on-request"],
    summary: "Fictional demo profile for event and portrait enquiries.",
    description: "A fictional demo scenario for event and portrait enquiries.",
    color: "#597dad",
    price: { min: 30_000, max: 68_000 },
  },
  {
    vendorSlug: "gadget-fix-lafia",
    vendorName: "Gadget Fix Lafia (Demo)",
    listingSlug: "phone-repair-enquiries",
    title: "Phone repair enquiries",
    category: "electronics",
    area: "lafia",
    capabilities: ["phone-repair", "screen-repair", "diagnostics"],
    availability: ["today", "on-request"],
    summary: "Fictional demo profile for device-repair enquiries.",
    description: "A fictional demo scenario for phone-repair enquiries.",
    color: "#6875a9",
    price: { min: 3_000, max: 25_000 },
  },
  {
    vendorSlug: "quick-screen-demo",
    vendorName: "Quick Screen Desk (Demo)",
    listingSlug: "screen-and-battery-check",
    title: "Screen and battery check",
    category: "electronics",
    area: "shendam-road",
    capabilities: ["phone-repair", "screen-repair", "battery-check"],
    availability: ["today", "on-request"],
    summary: "Fictional demo repair desk for phone-service enquiries.",
    description: "A fictional demo scenario for phone-service enquiries.",
    color: "#596aa0",
    price: { min: 2_500, max: 22_000 },
  },
  {
    vendorSlug: "quiet-courtyard-demo",
    vendorName: "Quiet Courtyard Kitchen (Demo)",
    listingSlug: "quiet-dinner-table",
    title: "Quiet dinner table enquiry",
    category: "food-restaurants",
    area: "lafia",
    capabilities: ["restaurant", "quiet", "dinner", "sit-down"],
    availability: ["tonight", "today", "on-request"],
    summary: "Fictional demo restaurant scenario for calm dinner searches.",
    description: "A fictional demo scenario for a calm dinner enquiry.",
    color: "#a46b48",
    price: { min: 3_500, max: 11_000 },
  },
  {
    vendorSlug: "garden-table-demo",
    vendorName: "Garden Table Lafia (Demo)",
    listingSlug: "garden-dinner-enquiry",
    title: "Quiet garden dinner enquiry",
    category: "food-restaurants",
    area: "bukan-sidi",
    capabilities: ["restaurant", "quiet", "dinner", "outdoor-seating"],
    availability: ["tonight", "weekend", "on-request"],
    summary: "Fictional demo dining profile for evening enquiries.",
    description: "A fictional demo scenario for an evening meal enquiry.",
    color: "#8d7650",
    price: { min: 4_000, max: 12_000 },
  },
  {
    vendorSlug: "lafia-power-hire-demo",
    vendorName: "Lafia Power Hire (Demo)",
    listingSlug: "30kva-generator-hire",
    title: "30KVA generator hire enquiry",
    category: "equipment-hire",
    area: "makurdi-road",
    capabilities: ["generator-hire", "30kva", "temporary-power"],
    availability: ["today", "tomorrow", "on-request"],
    summary: "Fictional demo profile for temporary generator-hire enquiries.",
    description: "A fictional demo scenario for temporary power hire.",
    color: "#8b7743",
    price: { min: 45_000, max: 120_000 },
  },
  {
    vendorSlug: "solid-volt-demo",
    vendorName: "Solid Volt Rentals (Demo)",
    listingSlug: "event-generator-rental",
    title: "30KVA event generator rental enquiry",
    category: "equipment-hire",
    area: "jos-road",
    capabilities: ["generator-hire", "30kva", "event-power"],
    availability: ["today", "tomorrow", "on-request"],
    summary: "Fictional demo rental profile for generator enquiries.",
    description: "A fictional demo scenario for an event-power enquiry.",
    color: "#7c8050",
    price: { min: 50_000, max: 130_000 },
  },
  {
    vendorSlug: "zizi-collections",
    vendorName: "Zizi Collections (Demo)",
    listingSlug: "everyday-wear",
    title: "Everyday wear and tailoring",
    category: "fashion",
    area: "tudun-gwandara",
    capabilities: ["tailoring", "everyday-wear", "alterations"],
    availability: ["on-request"],
    summary: "Fictional demo profile for locally styled clothing enquiries.",
    description: "A fictional demo scenario for clothing enquiries.",
    color: "#c36d73",
    price: { min: 5_000, max: 40_000 },
  },
  {
    vendorSlug: "soft-touch-beauty",
    vendorName: "Soft Touch Beauty (Demo)",
    listingSlug: "braiding-appointments",
    title: "Braiding appointment enquiry",
    category: "beauty",
    area: "lafia",
    capabilities: ["braiding", "salon", "beauty-appointment"],
    availability: ["on-request"],
    summary: "Fictional demo profile for beauty appointment enquiries.",
    description: "A fictional demo scenario for a salon enquiry.",
    color: "#aa7aaf",
    price: { min: 4_000, max: 25_000 },
  },
  {
    vendorSlug: "steady-hand-services",
    vendorName: "Steady Hand Services (Demo)",
    listingSlug: "home-repair-enquiries",
    title: "Home repair enquiries",
    category: "home-services",
    area: "bukan-sidi",
    capabilities: ["home-repair", "minor-electrical", "plumbing-enquiry"],
    availability: ["on-request"],
    summary: "Fictional demo profile for home-service enquiries.",
    description: "A fictional demo scenario for home repair enquiries.",
    color: "#738c9d",
    price: { min: 3_000, max: 35_000 },
  },
  {
    vendorSlug: "restful-corner-demo",
    vendorName: "Restful Corner Lodge (Demo)",
    listingSlug: "short-stay-enquiry",
    title: "Short-stay room enquiry",
    category: "hotels",
    area: "jos-road",
    capabilities: ["lodging", "short-stay", "room-enquiry"],
    availability: ["on-request"],
    summary: "Fictional demo lodging profile for room enquiries.",
    description: "A fictional demo scenario for a room enquiry.",
    color: "#627f91",
    price: { min: 12_000, max: 35_000 },
  },
  {
    vendorSlug: "wellness-desk-demo",
    vendorName: "Community Wellness Desk (Demo)",
    listingSlug: "wellness-information-enquiry",
    title: "Non-emergency wellness information",
    category: "health",
    area: "lafia",
    capabilities: ["wellness-information", "clinic-enquiry"],
    availability: ["on-request"],
    summary: "Fictional demo profile for non-emergency wellness enquiries.",
    description:
      "A fictional demo scenario for non-emergency information enquiries; not medical advice.",
    color: "#5d8c83",
  },
];

const formatDemoRange = ({ min, max }: NairaRange) =>
  `Fictional demo range: ₦${min.toLocaleString("en-NG")}–₦${max.toLocaleString("en-NG")}; confirm real quotes.`;

const serviceAreasFor = (seed: DemoSeed, label: string) => [
  ...new Set([label, ...(seed.extraAreas ?? []), "Lafia"]),
];

export const vendors: readonly Vendor[] = catalogSeeds.map((seed) => {
  const area = getDemoArea(seed.area);
  return {
    slug: seed.vendorSlug,
    name: seed.vendorName,
    category: seed.category,
    location: area.label,
    coordinates: area.coordinates,
    serviceAreas: serviceAreasFor(seed, area.label),
    capabilityTags: seed.capabilities,
    summary: seed.summary,
    color: seed.color,
    provenance: FICTIONAL_DEMO_PROVENANCE,
  };
});

export const listings: readonly Listing[] = catalogSeeds.map((seed) => {
  const area = getDemoArea(seed.area);
  return {
    slug: seed.listingSlug,
    vendor: seed.vendorSlug,
    title: seed.title,
    category: seed.category,
    location: area.label,
    coordinates: area.coordinates,
    serviceAreas: serviceAreasFor(seed, area.label),
    capabilityTags: seed.capabilities,
    availabilityWindows: seed.availability,
    description: seed.description,
    isOrderable: false,
    priceRangeNaira: seed.price,
    priceNote: seed.price ? formatDemoRange(seed.price) : undefined,
    availabilityNote:
      seed.availability.length > 1
        ? "The schedule is fictional demo data, not live availability."
        : "Availability must be confirmed; this directory entry is fictional.",
    color: seed.color,
    provenance: FICTIONAL_DEMO_PROVENANCE,
  };
});

export const getCategory = (slug: string) =>
  categories.find((category) => category.slug === slug);
export const getCategoryRouteKey = (category: Category) =>
  category.routeKey ?? category.slug;
export const getVendor = (slug: string) =>
  vendors.find((vendor) => vendor.slug === slug);
export const getListing = (slug: string) =>
  listings.find((listing) => listing.slug === slug);
export const getVendorListings = (vendor: string) =>
  listings.filter((listing) => listing.vendor === vendor);

export const getListingRouteKey = (listing: Listing) =>
  listing.routeKey ?? listing.slug;

export const isPublishableCatalogRecord = (record: {
  provenance?: CatalogProvenance;
}) => record.provenance?.kind !== "fictional-demo";

export const isCatalogRecordVisible = (
  record: { provenance?: CatalogProvenance },
  demoMode: boolean,
) => demoMode || isPublishableCatalogRecord(record);

export const filterCatalogRecordsForMode = <
  T extends { provenance?: CatalogProvenance },
>(
  records: readonly T[],
  demoMode: boolean,
): T[] => records.filter((record) => isCatalogRecordVisible(record, demoMode));
