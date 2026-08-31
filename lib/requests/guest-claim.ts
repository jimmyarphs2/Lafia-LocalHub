import { safeReturnPath } from "@/lib/auth/redirects";
import { listingCommitmentKindForPath } from "@/lib/orders/navigation";

export type GuestIntentClaim =
  | {
      state: "claimed";
      kind: "listing_request" | "listing_order" | "continue" | "sign_in";
      returnTo: string;
    }
  | { state: "terminal"; returnTo: string | null }
  | { state: "transient" };

function row(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value) && value.length !== 1) return null;
  const item = Array.isArray(value) ? value[0] : value;
  return item && typeof item === "object" && !Array.isArray(item)
    ? (item as Record<string, unknown>)
    : null;
}

/** The database returns a deliberately small claim result; no payload crosses this boundary. */
export function parseGuestIntentClaim(
  data: unknown,
  error: unknown,
): GuestIntentClaim {
  if (error) return { state: "transient" };
  const value = row(data);
  const outcome = value?.outcome ?? value?.status;
  const returnTo = safeReturnPath(
    typeof value?.return_to === "string" ? value.return_to : null,
    "",
  );
  if (
    outcome === "invalid" ||
    outcome === "expired" ||
    outcome === "claimed_by_other"
  ) {
    return { state: "terminal", returnTo: returnTo || null };
  }
  const kind = value?.kind;
  if (
    (outcome !== "claimed" && outcome !== "replayed") ||
    (kind !== "listing_request" &&
      kind !== "listing_order" &&
      kind !== "continue" &&
      kind !== "sign_in") ||
    !returnTo
  ) {
    return { state: "transient" };
  }
  if (
    (kind === "listing_request" || kind === "listing_order") &&
    listingCommitmentKindForPath(returnTo) !== kind
  ) {
    return { state: "transient" };
  }
  return {
    state: "claimed",
    kind,
    returnTo,
  };
}
