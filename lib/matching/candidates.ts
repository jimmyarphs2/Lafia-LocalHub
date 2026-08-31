import type { Listing } from "@/lib/catalog/data";
import type { SearchIntent } from "@/lib/catalog/search";

const searchableText = (listing: Listing) =>
  [
    listing.title,
    listing.description,
    listing.location,
    listing.category,
    ...listing.serviceAreas,
    ...listing.capabilityTags,
  ]
    .join(" ")
    .toLowerCase();

export function listingMatchesIntentCategory(
  intent: SearchIntent,
  listing: Listing,
): boolean {
  if (listing.categoryId && intent.categoryIds.length > 0) {
    return intent.categoryIds.includes(listing.categoryId);
  }
  return intent.categorySlugs.includes(listing.category);
}

export function getCandidateListings(
  intent: SearchIntent,
  source: readonly Listing[],
): Listing[] {
  return source.filter((listing) => {
    const categoryMatch = listingMatchesIntentCategory(intent, listing);
    const hasCategoryIntent =
      intent.categoryIds.length > 0 || intent.categorySlugs.length > 0;
    const capabilityMatch = intent.capabilityTags.some((tag) =>
      listing.capabilityTags.includes(tag),
    );

    if (intent.capabilityTags.length > 0) {
      return capabilityMatch && (!hasCategoryIntent || categoryMatch);
    }
    if (hasCategoryIntent) return categoryMatch;

    const haystack = searchableText(listing);
    const termHits = intent.terms.filter((term) => haystack.includes(term));
    return intent.terms.length === 1
      ? termHits.length === 1
      : termHits.length >= 2 && termHits.length / intent.terms.length >= 0.5;
  });
}

export type UnmatchedDemandHandoff = {
  type: "unmet_demand";
  version: 1;
  market: string;
  recognized: {
    categories: string[];
    capabilities: string[];
    budgetCeilingNaira?: number;
    area?: string;
    relativeTime?: SearchIntent["time"];
  };
};

/**
 * Produces a bounded, structured handoff without copying arbitrary free text.
 * The original query remains only in the user's return URL.
 */
export function createUnmatchedDemandHandoff(
  market: string,
  intent: SearchIntent,
): UnmatchedDemandHandoff {
  return {
    type: "unmet_demand",
    version: 1,
    market,
    recognized: {
      categories: intent.categorySlugs.slice(0, 3),
      capabilities: intent.capabilityTags.slice(0, 5),
      budgetCeilingNaira: intent.budgetNaira,
      area: intent.locationLabel,
      relativeTime: intent.time,
    },
  };
}
