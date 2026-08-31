import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DraftNavigationLink } from "@/components/vendor/draft-navigation-link";
import { ListingDraftWorkspace } from "@/components/vendor/listing-draft-workspace";
import { VendorProviderBlocker } from "@/components/vendor/provider-blocker";
import styles from "@/components/vendor/vendor-onboarding.module.css";
import { getPublicSupabaseConfig } from "@/lib/config/env";
import { loadVendorListingDraftWorkspace } from "@/lib/listings/workspace";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Listing drafts | LocalHub",
  description:
    "Create and safely save unpublished LocalHub vendor listing drafts.",
  robots: { index: false, follow: false },
};

type MembershipBusiness = {
  id: string;
  name: string;
};

type ManagedBusiness = {
  id: string;
  name: string;
  role: "owner" | "manager";
};

type ManagedDraft = {
  id: string;
  title: string;
  draft_revision: number;
  updated_at: string;
};

function readQueryValue(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function ListingWorkspaceMessage({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section
      className={styles.blocker}
      aria-labelledby="listing-workspace-message-title"
    >
      <p className={styles.eyebrow}>Listing drafts</p>
      <h1 id="listing-workspace-message-title">{title}</h1>
      <p>{children}</p>
    </section>
  );
}

export default async function VendorListingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const requestedBusinessId = readQueryValue(query.business);
  const requestedListingId = readQueryValue(query.draft);

  if (!getPublicSupabaseConfig()) {
    return <VendorProviderBlocker kind="provider_not_configured" />;
  }

  const client = await getServerSupabaseClient();
  if (!client) return <VendorProviderBlocker kind="provider_not_configured" />;

  let authResult: Awaited<ReturnType<typeof client.auth.getUser>>;
  try {
    authResult = await client.auth.getUser();
  } catch {
    return <VendorProviderBlocker kind="authentication_unavailable" />;
  }

  if (!authResult.data.user) {
    const next = new URLSearchParams();
    if (requestedBusinessId) next.set("business", requestedBusinessId);
    if (requestedListingId) next.set("draft", requestedListingId);
    const path = `/vendor/listings${next.size ? `?${next.toString()}` : ""}`;
    redirect(`/auth?next=${encodeURIComponent(path)}`);
  }

  const membershipsResult = await client
    .from("business_memberships")
    .select("business_id,role,businesses!inner(id,name)")
    .eq("profile_id", authResult.data.user.id)
    .in("role", ["owner", "manager"])
    .not("accepted_at", "is", null);
  if (membershipsResult.error)
    return <VendorProviderBlocker kind="database_unavailable" />;

  const businesses = (
    (membershipsResult.data ?? []) as {
      business_id: string;
      role: "owner" | "manager";
      businesses: MembershipBusiness | MembershipBusiness[];
    }[]
  )
    .map((membership): ManagedBusiness | null => {
      const business = Array.isArray(membership.businesses)
        ? membership.businesses[0]
        : membership.businesses;
      return business
        ? {
            id: membership.business_id,
            name: business.name,
            role: membership.role,
          }
        : null;
    })
    .filter((business): business is ManagedBusiness => business !== null);

  if (businesses.length === 0) {
    return (
      <ListingWorkspaceMessage title="You do not manage a business yet.">
        Complete vendor onboarding first. Listing drafts are available only to
        accepted owners and managers of a LocalHub business.
      </ListingWorkspaceMessage>
    );
  }

  if (
    requestedBusinessId &&
    !businesses.some((business) => business.id === requestedBusinessId)
  ) {
    return (
      <ListingWorkspaceMessage title="This business is not available.">
        Listing drafts can only be opened for a business where you are an
        accepted owner or manager. Choose one of your managed businesses from
        the vendor workspace.
      </ListingWorkspaceMessage>
    );
  }

  let resolvedBusinessId = requestedBusinessId;
  if (requestedListingId && !resolvedBusinessId) {
    const listingResult = await client
      .from("listings")
      .select("business_id")
      .eq("id", requestedListingId)
      .eq("status", "draft")
      .maybeSingle();
    const listing = listingResult.data;
    if (
      listingResult.error ||
      !listing ||
      !businesses.some((business) => business.id === listing.business_id)
    ) {
      return (
        <ListingWorkspaceMessage title="This listing draft is not available.">
          It may belong to another business, no longer be a draft, or you may no
          longer have access.
        </ListingWorkspaceMessage>
      );
    }
    resolvedBusinessId = listing.business_id;
  }

  const activeBusiness =
    businesses.find((business) => business.id === resolvedBusinessId) ??
    businesses[0];
  const draftsResult = await client
    .from("listings")
    .select("id,title,draft_revision,updated_at")
    .eq("business_id", activeBusiness.id)
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (draftsResult.error) {
    return <VendorProviderBlocker kind="database_unavailable" />;
  }
  const drafts = (draftsResult.data ?? []) as ManagedDraft[];
  const loaded = await loadVendorListingDraftWorkspace(client, {
    targetBusinessId: activeBusiness.id,
    listingId: requestedListingId,
  });

  if (!loaded.ok) {
    if (loaded.reason === "listing_unavailable") {
      return (
        <ListingWorkspaceMessage title="This listing draft is not available.">
          It may belong to another business, no longer be a draft, or you may no
          longer have access. Choose one of your managed businesses to start a
          new unpublished draft.
        </ListingWorkspaceMessage>
      );
    }
    if (loaded.reason === "taxonomy_unavailable") {
      return (
        <ListingWorkspaceMessage title="Listing categories are not ready yet.">
          LocalHub could not find an approved category-to-schema mapping for
          this business. No placeholder form is shown because saved listing
          details must use the current taxonomy.
        </ListingWorkspaceMessage>
      );
    }
    return <VendorProviderBlocker kind="database_unavailable" />;
  }

  return (
    <>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>Vendor listing drafts</p>
        <h1>Create clear, unpublished listings for {activeBusiness.name}.</h1>
        <p>
          Save work as you go. Publishing, review, AI assistance, and media
          enhancement are intentionally not part of this workspace.
        </p>
      </header>

      <nav aria-label="Managed businesses" className={styles.nextAction}>
        <strong>
          {businesses.length > 1
            ? "Choose a business"
            : "Your managed business"}
        </strong>
        <div className={styles.actionGroup}>
          {businesses.map((business) => (
            <DraftNavigationLink
              aria-current={
                business.id === activeBusiness.id ? "page" : undefined
              }
              className={
                business.id === activeBusiness.id
                  ? styles.primaryButton
                  : styles.secondaryButton
              }
              href={`/vendor/listings?business=${encodeURIComponent(business.id)}`}
              key={business.id}
            >
              {business.name} ({business.role})
            </DraftNavigationLink>
          ))}
        </div>
      </nav>

      <nav
        aria-label="Unpublished listing drafts"
        className={styles.nextAction}
      >
        <strong>Your unpublished drafts</strong>
        <div className={styles.actionGroup}>
          <DraftNavigationLink
            aria-current={requestedListingId ? undefined : "page"}
            className={
              requestedListingId ? styles.secondaryButton : styles.primaryButton
            }
            href={`/vendor/listings?business=${encodeURIComponent(activeBusiness.id)}`}
          >
            New draft
          </DraftNavigationLink>
          {drafts.map((draft) => (
            <DraftNavigationLink
              aria-current={
                draft.id === requestedListingId ? "page" : undefined
              }
              className={
                draft.id === requestedListingId
                  ? styles.primaryButton
                  : styles.secondaryButton
              }
              href={`/vendor/listings?business=${encodeURIComponent(activeBusiness.id)}&draft=${encodeURIComponent(draft.id)}`}
              key={draft.id}
            >
              {draft.title} · revision {draft.draft_revision}
            </DraftNavigationLink>
          ))}
        </div>
        {drafts.length === 0 ? (
          <p>No saved drafts yet. Start with the approved form below.</p>
        ) : null}
      </nav>

      <ListingDraftWorkspace
        createIdempotencyKey={crypto.randomUUID()}
        key={`${loaded.workspace.businessId}:${loaded.workspace.mapping.schemaId}:${loaded.workspace.selectedDraft?.listingId ?? "new"}`}
        workspace={loaded.workspace}
      />
    </>
  );
}
