import { categories, listings } from "./data";
import type {
  AvailabilityWindow,
  CatalogLocation,
  Category,
  Listing,
} from "./data";
import { findDemoArea } from "@/lib/location/lafia";
import type { GeoPoint } from "@/lib/location/haversine";
import {
  createUnmatchedDemandHandoff,
  type UnmatchedDemandHandoff,
} from "@/lib/matching/candidates";
import { rankListings, type ListingMatch } from "@/lib/matching/rank";

export type SearchIntent = {
  raw: string;
  normalized: string;
  categorySlugs: string[];
  categoryIds: string[];
  capabilityTags: string[];
  budgetNaira?: number;
  location?: string;
  locationLabel?: string;
  locationCoordinates?: GeoPoint;
  time?: Exclude<AvailabilityWindow, "on-request">;
  terms: string[];
};

export type SearchCatalogContext = {
  categories?: readonly Category[];
  locations?: readonly CatalogLocation[];
};

const MAX_QUERY_LENGTH = 160;
const budgetPatterns = [
  /(?:under|below|less than|max(?:imum)?|up to)\s*(?:₦|ngn)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|thousand)?/i,
  /budget(?:\s*(?:of|is|:))?\s*(?:₦|ngn)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|thousand)?/i,
  /(?:₦|ngn)\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|thousand)?/i,
] as const;

const timeRules: ReadonlyArray<
  [RegExp, Exclude<AvailabilityWindow, "on-request">]
> = [
  [/\bnext saturday\b/i, "next-saturday"],
  [/\btonight\b/i, "tonight"],
  [/\btomorrow\b/i, "tomorrow"],
  [/\btoday\b/i, "today"],
  [/\b(?:this )?weekend\b/i, "weekend"],
  [/\bsaturday\b/i, "saturday"],
];

const capabilityRules: ReadonlyArray<[string, RegExp]> = [
  ["birthday-cake", /\bbirthday\s+cake\b/i],
  ["cake", /\bcakes?\b|\bbakery\b/i],
  ["introduction-ceremony", /\bintroduction\s+ceremony\b/i],
  [
    "photography",
    /\bphotograph(?:er|ers|y|ic)?\b|\bphoto\s*(?:shoot|coverage)?\b/i,
  ],
  ["phone-repair", /\bphone\s+repair\b|\brepair\s+(?:my\s+)?phone\b/i],
  ["screen-repair", /\b(?:phone\s+)?screen\b/i],
  ["restaurant", /\brestaurants?\b/i],
  ["quiet", /\bquiet\b|\bcalm\b/i],
  ["dinner", /\bdinner\b|\bevening meal\b/i],
  ["generator-hire", /\bgenerator(?:\s+(?:hire|rental))?\b/i],
  ["30kva", /\b30\s*kva\b/i],
  ["tailoring", /\btailor(?:ing)?\b|\balterations?\b/i],
  ["braiding", /\bbraid(?:ing|s)?\b/i],
  ["home-repair", /\bhome\s+repair\b/i],
  ["lodging", /\bhotel\b|\blodg(?:e|ing)\b|\bshort[ -]stay\b/i],
  ["wellness-information", /\bwellness\b|\bhealth information\b/i],
];

const stopWords = new Set([
  "a",
  "an",
  "the",
  "for",
  "near",
  "around",
  "me",
  "my",
  "i",
  "in",
  "at",
  "need",
  "find",
  "looking",
  "with",
  "under",
  "below",
  "budget",
  "tonight",
  "tomorrow",
  "today",
  "next",
  "saturday",
  "weekend",
]);

function escapeForPhraseBoundary(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function includesAliasPhrase(text: string, alias: string): boolean {
  const escapedAlias = escapeForPhraseBoundary(alias.trim());
  if (!escapedAlias) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escapedAlias}(?=$|[^a-z0-9])`, "i").test(
    text,
  );
}

function extractBudget(normalized: string) {
  for (const pattern of budgetPatterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const numeric = Number(match[1].replace(/,/g, ""));
    const amount = numeric * (match[2] ? 1_000 : 1);
    return {
      amount: Number.isFinite(amount) ? Math.round(amount) : undefined,
      matchedText: match[0],
    };
  }
  return { amount: undefined, matchedText: "" };
}

function findCatalogLocation(
  normalized: string,
  locations: readonly CatalogLocation[],
): CatalogLocation | undefined {
  return locations
    .filter((location) =>
      [location.name, location.slug.replaceAll("-", " ")].some((alias) =>
        includesAliasPhrase(normalized, alias),
      ),
    )
    .sort(
      (left, right) =>
        right.name.length - left.name.length ||
        left.slug.localeCompare(right.slug),
    )[0];
}

export function parseSearchIntent(
  query: string,
  context: SearchCatalogContext = {},
): SearchIntent {
  const raw = query
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
  const normalized = raw.toLowerCase().replace(/\s+/g, " ");
  const budget = extractBudget(normalized);
  const matchedCategories = (context.categories ?? categories).filter(
    (category) =>
      category.aliases.some((alias) => includesAliasPhrase(normalized, alias)),
  );
  const categorySlugs = matchedCategories.map((category) => category.slug);
  const categoryIds = matchedCategories.flatMap((category) =>
    category.id ? [category.id] : [],
  );
  const capabilityTags = capabilityRules
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([tag]) => tag);
  const area =
    context.locations === undefined
      ? findDemoArea(normalized)
      : findCatalogLocation(normalized, context.locations);
  const areaLabel = area && ("label" in area ? area.label : area.name);
  const time = timeRules.find(([pattern]) => pattern.test(normalized))?.[1];
  const terms = normalized
    .replace(budget.matchedText, " ")
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !stopWords.has(term));

  return {
    raw,
    normalized,
    categorySlugs,
    categoryIds,
    capabilityTags,
    budgetNaira: budget.amount,
    location: areaLabel?.toLowerCase(),
    locationLabel: areaLabel,
    locationCoordinates: area?.coordinates,
    time,
    terms: [...new Set(terms)],
  };
}

export type CatalogSearchResult = {
  intent: SearchIntent;
  results: Listing[];
  matches: ListingMatch[];
  unmatchedDemand?: UnmatchedDemandHandoff;
};

export function searchListings(
  query: string,
  market: string,
  source: readonly Listing[] = listings,
  context: SearchCatalogContext = {},
): CatalogSearchResult {
  const intent = parseSearchIntent(query, context);
  if (!intent.normalized) {
    return { intent, results: [...source], matches: [] };
  }

  const matches = rankListings(intent, source);
  const results = matches.map((match) => match.listing);
  return {
    intent,
    results,
    matches,
    unmatchedDemand:
      results.length === 0
        ? createUnmatchedDemandHandoff(market, intent)
        : undefined,
  };
}

export function describeIntent(intent: SearchIntent) {
  const facts: string[] = [];
  if (intent.budgetNaira !== undefined) {
    facts.push(`budget up to ₦${intent.budgetNaira.toLocaleString("en-NG")}`);
  }
  if (intent.locationLabel) facts.push(`around ${intent.locationLabel}`);
  if (intent.time) {
    const timeLabel = intent.time.replace("-", " ");
    facts.push(`needed ${timeLabel}`);
  }
  return facts.join(" · ");
}
