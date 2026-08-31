import type { Listing } from "@/lib/catalog/data";
import type { SearchIntent } from "@/lib/catalog/search";
import { listingMatchesIntentCategory } from "./candidates";
import { assessDemoDistance } from "./distance";

export const MATCH_WEIGHTS = Object.freeze({
  relevance: 35,
  availability: 20,
  distance: 20,
  budget: 15,
  merchantRating: 10,
});

export type MatchDimension = keyof typeof MATCH_WEIGHTS;
export type MatchComponent = {
  dimension: MatchDimension;
  label: string;
  baselineWeight: number;
  score: number | null;
  reason: string;
};

export type ScoredListing = {
  listing: Listing;
  score: number;
  band: "Strong match" | "Good match" | "Possible match";
  components: MatchComponent[];
  missingEvidence: MatchDimension[];
  scoreNotice: string;
};

function relevanceScore(intent: SearchIntent, listing: Listing) {
  const categoryMatch = listingMatchesIntentCategory(intent, listing);
  const matchingCapabilities = intent.capabilityTags.filter((tag) =>
    listing.capabilityTags.includes(tag),
  );
  const capabilityRatio = intent.capabilityTags.length
    ? matchingCapabilities.length / intent.capabilityTags.length
    : 0;
  const haystack = [
    listing.title,
    listing.description,
    listing.location,
    ...listing.capabilityTags,
  ]
    .join(" ")
    .toLowerCase();
  const termRatio = intent.terms.length
    ? intent.terms.filter((term) => haystack.includes(term)).length /
      intent.terms.length
    : 0;

  if (
    intent.categoryIds.length ||
    intent.categorySlugs.length ||
    intent.capabilityTags.length
  ) {
    return Math.round(
      (categoryMatch ? 55 : 0) + capabilityRatio * 35 + termRatio * 10,
    );
  }
  return Math.round(termRatio * 100);
}

function availabilityScore(intent: SearchIntent, listing: Listing) {
  const isFictionalDemo = listing.provenance?.kind === "fictional-demo";
  if (!intent.time) {
    return {
      score: null,
      reason:
        "No time was supplied, so availability did not affect this score.",
    };
  }
  if (listing.availabilityWindows.includes(intent.time)) {
    return {
      score: 100,
      reason: isFictionalDemo
        ? `The fictional demo schedule includes ${intent.time.replace("-", " ")}; confirm real availability.`
        : `The listed schedule includes ${intent.time.replace("-", " ")}; confirm availability with the vendor.`,
    };
  }
  if (listing.availabilityWindows.includes("on-request")) {
    return {
      score: 35,
      reason: isFictionalDemo
        ? "The fictional demo schedule says on request; no live availability is known."
        : "The listed schedule says on request; confirm availability with the vendor.",
    };
  }
  return {
    score: 0,
    reason: isFictionalDemo
      ? "The requested time is not present in this fictional demo schedule."
      : "The requested time is not present in the listed schedule.",
  };
}

function budgetScore(intent: SearchIntent, listing: Listing) {
  const isFictionalDemo = listing.provenance?.kind === "fictional-demo";
  if (intent.budgetNaira === undefined) {
    return {
      score: null,
      reason: "No budget was supplied, so price did not affect this score.",
    };
  }
  const range = listing.priceRangeNaira;
  if (!range) {
    return {
      score: null,
      reason: isFictionalDemo
        ? "No verified price evidence is available for this demo listing."
        : "No price-range evidence is available for this listing.",
    };
  }
  if (range.max <= intent.budgetNaira) {
    return {
      score: 100,
      reason: isFictionalDemo
        ? "The fictional demo range is within the stated budget; confirm a real quote."
        : "The listed range is within the stated budget; confirm the current quote.",
    };
  }
  if (range.min <= intent.budgetNaira) {
    return {
      score: 55,
      reason: isFictionalDemo
        ? "The budget overlaps the fictional demo range; confirm a real quote."
        : "The budget overlaps the listed range; confirm the current quote.",
    };
  }
  return {
    score: 0,
    reason: isFictionalDemo
      ? "The stated budget is below this fictional demo range."
      : "The stated budget is below the listed range.",
  };
}

export function scoreListing(
  intent: SearchIntent,
  listing: Listing,
): ScoredListing {
  const isFictionalDemo = listing.provenance?.kind === "fictional-demo";
  const availability = availabilityScore(intent, listing);
  const distance = assessDemoDistance(intent, listing);
  const budget = budgetScore(intent, listing);
  const components: MatchComponent[] = [
    {
      dimension: "relevance",
      label: "Request relevance",
      baselineWeight: MATCH_WEIGHTS.relevance,
      score: relevanceScore(intent, listing),
      reason:
        "Category, capability, and request terms are compared by deterministic rules.",
    },
    {
      dimension: "availability",
      label: "Requested time",
      baselineWeight: MATCH_WEIGHTS.availability,
      ...availability,
    },
    {
      dimension: "distance",
      label: "Approximate distance",
      baselineWeight: MATCH_WEIGHTS.distance,
      score: distance.score,
      reason: distance.reason,
    },
    {
      dimension: "budget",
      label: "Budget fit",
      baselineWeight: MATCH_WEIGHTS.budget,
      ...budget,
    },
    {
      dimension: "merchantRating",
      label: "Merchant rating",
      baselineWeight: MATCH_WEIGHTS.merchantRating,
      score: null,
      reason: isFictionalDemo
        ? "No verified merchant rating exists in demo data, so rating is excluded and remaining weights are renormalized."
        : "No merchant rating evidence is available, so rating is excluded and remaining weights are renormalized.",
    },
  ];
  const scoredComponents = components.filter(
    (component): component is MatchComponent & { score: number } =>
      component.score !== null,
  );
  const appliedWeight = scoredComponents.reduce(
    (sum, component) => sum + component.baselineWeight,
    0,
  );
  const score = Math.round(
    scoredComponents.reduce(
      (sum, component) => sum + component.score * component.baselineWeight,
      0,
    ) / appliedWeight,
  );

  return {
    listing,
    score,
    band:
      score >= 80
        ? "Strong match"
        : score >= 60
          ? "Good match"
          : "Possible match",
    components,
    missingEvidence: components
      .filter((component) => component.score === null)
      .map((component) => component.dimension),
    scoreNotice: isFictionalDemo
      ? "Rule-based directory fit from fictional demo evidence—not a probability, endorsement, or live availability claim."
      : "Rule-based directory fit from listing evidence—not a probability, endorsement, or availability guarantee.",
  };
}
