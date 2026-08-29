import type { DemoProvenance, DemoSeedMetadata } from "./demo";
import type { BusinessLocation } from "./location";

export const BUSINESS_STATUSES = [
  "pending",
  "approved",
  "suspended",
  "rejected",
] as const;

export const BUSINESS_VERIFICATION_STATUSES = [
  "unverified",
  "pending",
  "verified",
] as const;

export const LISTING_KINDS = ["product", "service"] as const;
export const LISTING_STATUSES = ["draft", "published", "unpublished"] as const;
export const FULFILMENT_METHODS = [
  "pickup",
  "merchant_delivery",
  "on_site",
  "remote",
] as const;

export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];
export type BusinessVerificationStatus =
  (typeof BUSINESS_VERIFICATION_STATUSES)[number];
export type ListingKind = (typeof LISTING_KINDS)[number];
export type ListingStatus = (typeof LISTING_STATUSES)[number];
export type FulfilmentMethod = (typeof FULFILMENT_METHODS)[number];

export interface Money {
  amount: number;
  currency: "NGN";
}

export interface MoneyRange {
  minimum: number;
  maximum: number;
  currency: "NGN";
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  iconKey: string;
  isActive: boolean;
  sortOrder: number;
  provenance?: DemoProvenance;
}

export interface DailyBusinessHours {
  day:
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
    | "saturday"
    | "sunday";
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
}

export interface Business {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  description: string;
  status: BusinessStatus;
  verificationStatus: BusinessVerificationStatus;
  categorySlugs: readonly string[];
  phone: string | null;
  whatsapp: string | null;
  location: BusinessLocation;
  openingHours: readonly DailyBusinessHours[];
  rating: number | null;
  reviewCount: number;
  priceRange: MoneyRange | null;
  profileImageUrl: string | null;
  coverImageUrl: string | null;
  tags: readonly string[];
  provenance?: DemoProvenance;
}

export interface ListingAvailability {
  isAvailable: boolean;
  leadTimeMinutes: number | null;
  note: string | null;
}

export interface Listing {
  id: string;
  businessId: string;
  slug: string;
  kind: ListingKind;
  status: ListingStatus;
  categorySlug: string;
  title: string;
  description: string;
  price: MoneyRange;
  priceLabel: string | null;
  availability: ListingAvailability;
  fulfilmentMethods: readonly FulfilmentMethod[];
  imageUrl: string | null;
  imageAlt: string;
  tags: readonly string[];
  provenance?: DemoProvenance;
}

export interface DemoCommerceSeed {
  metadata: DemoSeedMetadata;
  categories: readonly Category[];
  businesses: readonly Business[];
  listings: readonly Listing[];
}
