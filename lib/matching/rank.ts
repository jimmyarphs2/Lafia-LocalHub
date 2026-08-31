import { getListingRouteKey, type Listing } from "@/lib/catalog/data";
import type { SearchIntent } from "@/lib/catalog/search";
import { getCandidateListings } from "./candidates";
import { scoreListing, type ScoredListing } from "./score";

export type ListingMatch = ScoredListing;

const distanceForSort = (match: ListingMatch) =>
  match.components.find((component) => component.dimension === "distance")
    ?.score ?? -1;

export function rankListings(
  intent: SearchIntent,
  source: readonly Listing[],
): ListingMatch[] {
  return getCandidateListings(intent, source)
    .map((listing) => scoreListing(intent, listing))
    .sort(
      (left, right) =>
        right.score - left.score ||
        distanceForSort(right) - distanceForSort(left) ||
        getListingRouteKey(left.listing).localeCompare(
          getListingRouteKey(right.listing),
        ),
    );
}
