import type { Metadata } from "next";
import { Clock3, MapPin, Store } from "lucide-react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CatalogStateNotice } from "@/components/catalog-ui";
import {
  CommitmentLink,
  DemoCommitmentNotice,
  normalizeSearchContext,
} from "@/components/commitment-link";
import { OrderIntentForm } from "@/components/order-intent-form";
import {
  getCategoryRouteKey,
  getListingRouteKey,
  listings,
} from "@/lib/catalog/data";
import { getCatalogForMarket } from "@/lib/catalog/source";
import { serializeJsonLd } from "@/lib/catalog/structured-data";
import { getPublicUrl, isDemoMode } from "@/lib/market/public-url";
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
        title: `${listing.title} in ${market}`,
        description: listing.description,
        alternates: { canonical: getPublicUrl(`/${market}/listings/${slug}`) },
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
          <Link href={`/${market}`}>Directory</Link> / Listing
        </p>
        <CatalogStateNotice state={catalog.state} subject="listing" />
      </section>
    );
  }
  const listing = catalog.listings.find(
    (item) => getListingRouteKey(item) === slug,
  );
  if (!listing) notFound();
  const isFictionalDemo = listing.provenance?.kind === "fictional-demo";
  const isDirectOrderAvailable =
    !isFictionalDemo && listing.isOrderable === true;
  const vendor = catalog.vendors.find((item) => item.slug === listing.vendor);
  const category = catalog.categories.find((item) =>
    listing.categoryId
      ? item.id === listing.categoryId
      : item.slug === listing.category,
  );
  const action =
    listing.category === "photography" || listing.category === "beauty"
      ? "request-booking"
      : "enquire";
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
      <div className="container">
        <p className="breadcrumbs">
          <Link href={`/${market}`}>Directory</Link> /{" "}
          {category ? (
            <>
              <Link
                href={`/${market}/categories/${getCategoryRouteKey(category)}`}
              >
                {category.name}
              </Link>{" "}
              /{" "}
            </>
          ) : null}
          {listing.title}
        </p>
        <div className="detail-grid">
          <section>
            {!isFictionalDemo && (
              <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
              />
            )}
            <div
              className="detail-visual"
              style={
                { "--listing-color": listing.color } as React.CSSProperties
              }
            />
            <div className="detail-copy">
              <p className="eyebrow">
                {isFictionalDemo
                  ? "Fictional demo listing"
                  : "Directory listing"}
              </p>
              <h1>{listing.title}</h1>
              <p>
                {listing.description ||
                  "This listing has not added a public description yet."}
              </p>
              {listing.priceNote && (
                <p className="listing-meta">{listing.priceNote}</p>
              )}
              {listing.availabilityNote && (
                <p className="listing-meta">{listing.availabilityNote}</p>
              )}
            </div>
          </section>
          <aside className="detail-sidebar">
            <h2>
              {isDirectOrderAvailable
                ? "Order or make a request"
                : "Make a request"}
            </h2>
            {orderRecovery ? (
              <p role="alert">
                {orderRecovery === "expired"
                  ? isDirectOrderAvailable
                    ? "That saved order has expired or is no longer available. You can safely start a new order from this listing."
                    : "That saved order has expired or is no longer available. This listing is not currently available for ordering."
                  : isDirectOrderAvailable
                    ? "We could not continue that order. You can safely start again from this listing."
                    : "We could not continue that order. This listing is not currently available for ordering."}
              </p>
            ) : null}
            {requestRecovery ? (
              <p role="alert">
                {requestRecovery === "expired"
                  ? "That saved request has expired or is no longer available. You can safely start a new request from this listing."
                  : "We could not continue that request. You can safely start a new request from this listing."}
              </p>
            ) : null}
            <p>
              Browsing is open. Signing in is only needed to send a commitment
              to a vendor.
            </p>
            <ul className="info-list">
              <li>
                <Store aria-hidden="true" size={18} />
                <span>
                  {vendor ? (
                    <Link
                      className="text-link"
                      href={`/${market}/vendors/${vendor.slug}${searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : ""}`}
                    >
                      {vendor.name}
                    </Link>
                  ) : isFictionalDemo ? (
                    "Demo vendor"
                  ) : (
                    "Vendor details"
                  )}
                </span>
              </li>
              {listing.location ? (
                <li>
                  <MapPin aria-hidden="true" size={18} />
                  <span>{listing.location}</span>
                </li>
              ) : null}
              <li>
                <Clock3 aria-hidden="true" size={18} />
                <span>
                  {listing.availabilityNote ??
                    "Details confirmed after an enquiry."}
                </span>
              </li>
            </ul>
            {isDirectOrderAvailable ? (
              <section aria-labelledby="direct-order-title">
                <h3 id="direct-order-title">Order this listing</h3>
                <p>
                  Choose a quantity to continue to a secure review. The live
                  price and availability are checked again before placement.
                </p>
                <OrderIntentForm
                  listing={getListingRouteKey(listing)}
                  market={market}
                />
                <p className="help">
                  A placed order awaits vendor confirmation. No payment is
                  collected.
                </p>
              </section>
            ) : null}
            {isDirectOrderAvailable ? <h3>Ask the vendor first</h3> : null}
            {isFictionalDemo ? (
              <DemoCommitmentNotice />
            ) : (
              <CommitmentLink
                action={action}
                market={market}
                listing={getListingRouteKey(listing)}
                query={searchQuery}
              />
            )}
          </aside>
        </div>
      </div>
      <section className="section section-alt">
        <div className="container commitment-box">
          <h2>What happens next?</h2>
          {isDirectOrderAvailable ? (
            <p>
              Starting an order carries only this listing and your chosen
              quantity to a secure review. Nothing is placed until you review
              and submit after sign-in. A placed order awaits vendor
              confirmation, and no payment is collected. You can still make a
              request instead when you need details first.
            </p>
          ) : (
            <p>
              Your selected action and this listing URL are carried safely to
              sign-in. Sending a commitment does not automatically place an
              order, booking, or message.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
