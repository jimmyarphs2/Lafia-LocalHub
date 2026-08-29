export const COMMERCE_INTENT_KINDS = [
  "buy_product",
  "hire_service",
  "find_business",
  "find_place",
  "browse",
] as const;

export const COMMERCE_URGENCY_LEVELS = ["low", "normal", "high"] as const;

export const RANKING_PRIORITIES = [
  "availability",
  "distance",
  "price",
  "rating",
  "relevance",
] as const;

export type CommerceIntentKind = (typeof COMMERCE_INTENT_KINDS)[number];
export type CommerceUrgency = (typeof COMMERCE_URGENCY_LEVELS)[number];
export type RankingPriority = (typeof RANKING_PRIORITIES)[number];

export interface CommerceIntent {
  rawQuery: string;
  intent: CommerceIntentKind;
  category?: string;
  product?: string;
  service?: string;
  locationText?: string;
  latitude?: number;
  longitude?: number;
  maxBudget?: number;
  minBudget?: number;
  currency: "NGN";
  neededDate?: string;
  neededTime?: string;
  urgency?: CommerceUrgency;
  preferences: string[];
  rankingPriorities: RankingPriority[];
}
