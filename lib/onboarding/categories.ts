export type ListingKind = "product" | "service" | "place";

export type OnboardingCategory = {
  slug: string;
  name: string;
  description: string;
  aliases: readonly string[];
  listingKind: ListingKind;
};

/**
 * A small, deterministic launch taxonomy. Database-backed categories can replace
 * this registry without changing the classifier or onboarding form contract.
 */
export const onboardingCategories: readonly OnboardingCategory[] = [
  {
    slug: "food-catering",
    name: "Food, bakery & catering",
    description: "Prepared food, drinks, baking and event catering.",
    aliases: [
      "food",
      "restaurant",
      "cook",
      "catering",
      "caterer",
      "cake",
      "cakes",
      "baker",
      "bakery",
      "pastry",
      "small chops",
      "zobo",
      "kunu",
    ],
    listingKind: "product",
  },
  {
    slug: "electronics-repair",
    name: "Electronics & device repair",
    description: "Phones, computers, accessories and device repairs.",
    aliases: [
      "electronics",
      "phone",
      "phones",
      "phone repair",
      "screen repair",
      "laptop",
      "computer",
      "gadget",
      "charger",
      "technician",
    ],
    listingKind: "service",
  },
  {
    slug: "photography-media",
    name: "Photography & media",
    description: "Photography, video and event media services.",
    aliases: [
      "photography",
      "photographer",
      "photo",
      "photos",
      "videography",
      "videographer",
      "camera",
      "event coverage",
    ],
    listingKind: "service",
  },
  {
    slug: "fashion-tailoring",
    name: "Fashion & tailoring",
    description: "Clothing, tailoring, fabrics and fashion accessories.",
    aliases: [
      "fashion",
      "tailor",
      "tailoring",
      "clothes",
      "clothing",
      "dress",
      "fabric",
      "ankara",
      "aso oke",
      "asooke",
      "caps",
    ],
    listingKind: "product",
  },
  {
    slug: "beauty-personal-care",
    name: "Beauty & personal care",
    description: "Hair, beauty, grooming and personal care services.",
    aliases: [
      "beauty",
      "salon",
      "hair",
      "barber",
      "barbing",
      "makeup",
      "braids",
      "nails",
      "spa",
    ],
    listingKind: "service",
  },
  {
    slug: "home-building-services",
    name: "Home & building services",
    description: "Repairs, construction, cleaning and household services.",
    aliases: [
      "home repair",
      "plumber",
      "plumbing",
      "electrician",
      "electrical",
      "carpenter",
      "carpentry",
      "cleaner",
      "cleaning",
      "painter",
      "mason",
      "tiler",
    ],
    listingKind: "service",
  },
  {
    slug: "events-venues",
    name: "Events & venues",
    description: "Event spaces, halls and event support.",
    aliases: [
      "venue",
      "event venue",
      "event hall",
      "hall",
      "conference room",
      "event space",
    ],
    listingKind: "place",
  },
  {
    slug: "transport-logistics",
    name: "Transport & logistics",
    description: "Local transport, delivery and moving services.",
    aliases: [
      "transport",
      "delivery",
      "dispatch",
      "logistics",
      "moving",
      "haulage",
      "driver",
      "taxi",
    ],
    listingKind: "service",
  },
  {
    slug: "education-training",
    name: "Education & training",
    description: "Tutoring, lessons, coaching and practical training.",
    aliases: [
      "teacher",
      "tutor",
      "tutoring",
      "lessons",
      "training",
      "coach",
      "school",
      "classes",
    ],
    listingKind: "service",
  },
  {
    slug: "other-local-trade",
    name: "Other local trade",
    description: "A local business or trade that needs a new category.",
    aliases: [],
    listingKind: "service",
  },
] as const;

export const fallbackOnboardingCategory = onboardingCategories.at(-1)!;

export function getOnboardingCategory(
  slug: string,
): OnboardingCategory | undefined {
  return onboardingCategories.find((category) => category.slug === slug);
}

export function isOnboardingCategorySlug(slug: string): boolean {
  return getOnboardingCategory(slug) !== undefined;
}
