import type { Metadata } from "next";

import {
  VendorMediaUploader,
  type VendorMediaListing,
  type VendorMediaProviderState,
} from "@/components/vendor/media/vendor-media-uploader";
import { getPublicSupabaseConfig } from "@/lib/config/env";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Vendor media lab | LocalHub",
  description:
    "A protected LocalHub foundation for attaching original media to vendor listings.",
};

async function loadVendorMediaListings(): Promise<{
  listings: VendorMediaListing[];
  providerState: VendorMediaProviderState;
}> {
  if (!getPublicSupabaseConfig()) {
    return { listings: [], providerState: "provider_not_configured" };
  }

  const client = await getServerSupabaseClient();
  if (!client) return { listings: [], providerState: "unavailable" };

  try {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) return { listings: [], providerState: "unavailable" };
    if (!userData.user) {
      return { listings: [], providerState: "authentication_required" };
    }

    const membershipResult = await client
      .from("business_memberships")
      .select("business_id,role")
      .eq("profile_id", userData.user.id)
      .in("role", ["owner", "manager"])
      .not("accepted_at", "is", null);
    if (membershipResult.error) {
      return { listings: [], providerState: "unavailable" };
    }

    const memberships = membershipResult.data as {
      business_id: string;
      role: string;
    }[];
    const businessIds = [...new Set(memberships.map((row) => row.business_id))];
    if (businessIds.length === 0) {
      return { listings: [], providerState: "ready" };
    }

    const listingsResult = await client
      .from("listings")
      .select("id,title,status")
      .in("business_id", businessIds)
      .eq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (listingsResult.error) {
      return { listings: [], providerState: "unavailable" };
    }

    return {
      listings: (listingsResult.data as VendorMediaListing[]) ?? [],
      providerState: "ready",
    };
  } catch {
    return { listings: [], providerState: "unavailable" };
  }
}

export default async function VendorMediaLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const requestedListingId =
    typeof query.listing === "string" && query.listing.length > 0
      ? query.listing
      : undefined;
  const state = await loadVendorMediaListings();
  const initialListingId = state.listings.some(
    (listing) => listing.id === requestedListingId,
  )
    ? requestedListingId
    : undefined;

  return (
    <>
      <section aria-labelledby="media-lab-title">
        <p>Vendor tools · secure foundation</p>
        <h1 id="media-lab-title">Listing media lab</h1>
        <p>
          Upload and confirm an original without sending file bytes through the
          Next.js server. Enhancement, moderation, verification media, and
          publishing remain separate production gates.
        </p>
      </section>
      <VendorMediaUploader
        initialListingId={initialListingId}
        key={initialListingId ?? state.listings.at(0)?.id ?? "no-listing"}
        listings={state.listings}
        providerState={state.providerState}
      />
    </>
  );
}
