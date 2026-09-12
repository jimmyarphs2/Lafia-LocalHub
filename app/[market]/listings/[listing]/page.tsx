import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";

import { CatalogStateNotice } from "@/components/catalog-ui";
import { normalizeSearchContext } from "@/components/commitment-link";
import { ListingProfileExperience } from "@/components/listing-profile-experience";
import { getListingRouteKey, listings } from "@/lib/catalog/data";
import { getCatalogForMarket } from "@/lib/catalog/source";
import { serializeJsonLd } from "@/lib/catalog/structured-data";
import { getPublicUrl, isDemoMode } from "@/lib/market/public-url";

// The shared market shell reads cookie-scoped identity. Listing profiles must
// therefore render per request even when demo slugs are known at build time.
export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return isDemoMode() ? listings.map(({ slug: listing }) => ({ listing })) : [];
}

export async function generateMetadata({
  params,
}: PageProps<"/[market]/listings/[listing]">): Promise<Metadata> {
  const { market, listing: slug } = await params;
  const catalog = await getCatalogForMarket(market);
  if (catalog.state !== "ready") {
    return { robots: { index: false, follow: false } };
  }
  const listing = catalog.listings.find(
    (item) => getListingRouteKey(item) === slug,
  );
  return listing
    ? {
        title: listing.title + " in " + market,
        description: listing.description,
        alternates: {
          canonical: getPublicUrl("/" + market + "/listings/" + slug),
        },
      }
    : {};
}

export default async function ListingPage({
  params,
  searchParams,
}: PageProps<"/[market]/listings/[listing]">) {
  const [{ market, listing: slug }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const searchQuery = normalizeSearchContext(
    typeof query.q === "string" ? query.q : undefined,
  );
  const requestRecovery =
    typeof query.request === "string" &&
    (query.request === "expired" || query.request === "unavailable")
      ? query.request
      : null;
  const orderRecovery =
    typeof query.order === "string" &&
    (query.order === "expired" || query.order === "unavailable")
      ? query.order
      : null;

  const catalog = await getCatalogForMarket(market);
  if (catalog.state !== "ready") {
    return (
      <section className="container section">
        <p className="breadcrumbs">
          <Link href={"/" + market}>Directory</Link> / Listing
        </p>
        <CatalogStateNotice state={catalog.state} subject="listing" />
      </section>
    );
  }

  const listing = catalog.listings.find(
    (item) => getListingRouteKey(item) === slug,
  );
  if (!listing) notFound();

  const vendor = catalog.vendors.find((item) => item.slug === listing.vendor);
  const category = catalog.categories.find((item) =>
    listing.categoryId
      ? item.id === listing.categoryId
      : item.slug === listing.category,
  );
  const relatedListings = catalog.listings
    .filter(
      (item) =>
        getListingRouteKey(item) !== getListingRouteKey(listing) &&
        (listing.categoryId
          ? item.categoryId === listing.categoryId
          : item.category === listing.category),
    )
    .slice(0, 3);
  const action =
    listing.category === "photography" || listing.category === "beauty"
      ? "request-booking"
      : "enquire";
  const isFictionalDemo = listing.provenance?.kind === "fictional-demo";
  const isDirectOrderAvailable =
    !isFictionalDemo && listing.isOrderable === true;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: listing.title,
    description: listing.description,
    areaServed: listing.location || undefined,
    provider: vendor
      ? { "@type": "LocalBusiness", name: vendor.name }
      : undefined,
  };

  return (
    <>
      {!isFictionalDemo ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      ) : null}
      <ListingProfileExperience
        action={action}
        category={category}
        isDirectOrderAvailable={isDirectOrderAvailable}
        listing={listing}
        market={market}
        orderRecovery={orderRecovery}
        relatedListings={relatedListings}
        requestRecovery={requestRecovery}
        searchQuery={searchQuery}
        vendor={vendor}
      />
    </>
  );
}
