import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type AuthorizedListing = {
  listingId: string;
  businessId: string;
  userId: string;
};

export type ListingMediaAuthorization =
  | { ok: true; listing: AuthorizedListing }
  | {
      ok: false;
      reason: "authentication_required" | "listing_access_denied";
    };

export type ListingMediaAuthorizationPurpose = "draft_upload" | "cleanup";

/**
 * Authenticates and authorizes inside every media route. The business ID is
 * derived from the RLS-filtered listing row and never accepted from the client.
 * Upload paths require a draft listing; cleanup retains manager access after a
 * later status transition so an already-attached original is never stranded.
 */
export async function authorizeListingMedia(
  client: SupabaseClient,
  listingId: string,
  purpose: ListingMediaAuthorizationPurpose = "draft_upload",
): Promise<ListingMediaAuthorization> {
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) {
    return { ok: false, reason: "authentication_required" };
  }

  let listingQuery = client
    .from("listings")
    .select("id,business_id,status")
    .eq("id", listingId);
  if (purpose === "draft_upload") {
    listingQuery = listingQuery.eq("status", "draft");
  }
  const listingResult = await listingQuery.maybeSingle();

  const listing = listingResult.data as {
    id: string;
    business_id: string;
    status: "draft" | "active" | "paused" | "archived";
  } | null;

  if (
    listingResult.error ||
    !listing ||
    (purpose === "draft_upload" && listing.status !== "draft")
  ) {
    return { ok: false, reason: "listing_access_denied" };
  }

  const managerResult = await client.rpc("is_business_manager", {
    target_business: listing.business_id,
  });

  if (managerResult.error || managerResult.data !== true) {
    return { ok: false, reason: "listing_access_denied" };
  }

  return {
    ok: true,
    listing: {
      listingId: listing.id,
      businessId: listing.business_id,
      userId: userData.user.id,
    },
  };
}
