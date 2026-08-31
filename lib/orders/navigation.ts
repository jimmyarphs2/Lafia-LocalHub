import { getAppUrl } from "@/lib/config/env";
import { safeReturnPath } from "@/lib/auth/redirects";
import { listingRouteSchema, marketSlugSchema } from "@/lib/requests/contract";

export type ListingCommitmentKind = "listing_request" | "listing_order";

export function listingCommitmentKindForPath(
  value: string,
): ListingCommitmentKind | null {
  const path = safeReturnPath(value, "");
  if (!path) return null;
  const segments = new URL(path, getAppUrl()).pathname
    .split("/")
    .filter(Boolean);
  if (
    segments.length !== 4 ||
    !marketSlugSchema.safeParse(segments[0]).success ||
    segments[1] !== "listings" ||
    !listingRouteSchema.safeParse(segments[2]).success
  ) {
    return null;
  }
  return segments[3] === "request"
    ? "listing_request"
    : segments[3] === "order"
      ? "listing_order"
      : null;
}

export function isListingOrderConfirmationPath(value: string): boolean {
  return listingCommitmentKindForPath(value) === "listing_order";
}

export function listingCommitmentConfirmationPath(
  returnTo: string,
  intentId: string,
  kind: ListingCommitmentKind,
): string | null {
  if (listingCommitmentKindForPath(returnTo) !== kind) return null;
  const destination = new URL(safeReturnPath(returnTo), getAppUrl());
  destination.searchParams.set("intent", intentId);
  return `${destination.pathname}${destination.search}`;
}

export function listingCommitmentRecoveryPath(
  returnTo: string | null,
  fallback: string,
): string {
  const path = safeReturnPath(returnTo, safeReturnPath(fallback));
  const destination = new URL(path || "/", getAppUrl());
  const kind = listingCommitmentKindForPath(
    `${destination.pathname}${destination.search}`,
  );
  if (kind === "listing_order") {
    destination.pathname =
      destination.pathname.slice(0, -"/order".length) || "/";
    destination.search = "";
    destination.searchParams.set("order", "expired");
    return `${destination.pathname}${destination.search}`;
  }
  if (kind === "listing_request") {
    destination.pathname =
      destination.pathname.slice(0, -"/request".length) || "/";
  }
  destination.search = "";
  destination.searchParams.set("request", "expired");
  return `${destination.pathname}${destination.search}`;
}
