import {
  ArrowLeft,
  CalendarClock,
  Clock3,
  ImageIcon,
  Info,
  MapPin,
  MessageSquareText,
  Navigation,
  ShieldCheck,
  Store,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import {
  CommitmentLink,
  normalizeSearchContext,
} from "@/components/commitment-link";
import { ListingProfileActions } from "@/components/listing-profile-actions";
import { OrderIntentForm } from "@/components/order-intent-form";
import {
  getListingRouteKey,
  type Category,
  type Listing,
  type Vendor,
} from "@/lib/catalog/data";

import styles from "./listing-profile-experience.module.css";

type RecoveryState = "expired" | "unavailable" | null;

type ListingProfileExperienceProps = {
  action: "enquire" | "request-booking";
  category?: Category;
  isDirectOrderAvailable: boolean;
  listing: Listing;
  market: string;
  orderRecovery: RecoveryState;
  relatedListings: readonly Listing[];
  requestRecovery: RecoveryState;
  searchQuery?: string;
  vendor?: Vendor;
};

const demoImages: Record<string, string> = {
  "made-to-order-cakes": "/images/localhub-demo-cake.webp",
  "shendam-celebration-cakes": "/images/localhub-demo-cake-pink.webp",
  "bukan-sidi-birthday-cakes": "/images/localhub-demo-cupcakes.webp",
  "event-photography": "/images/localhub-demo-photographer.webp",
  "family-event-photography": "/images/localhub-demo-photographer.webp",
  "ceremony-photo-coverage": "/images/localhub-demo-photographer.webp",
  "event-and-portrait-session": "/images/localhub-demo-photographer.webp",
  "30kva-generator-hire": "/images/localhub-demo-electrical.webp",
};

const currency = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

function listingImage(listing: Listing) {
  return listing.provenance?.kind === "fictional-demo"
    ? demoImages[listing.slug]
    : undefined;
}

function formatPrice(listing: Listing) {
  if (listing.priceRangeNaira) {
    const { min, max } = listing.priceRangeNaira;
    return min === max
      ? currency.format(min)
      : currency.format(min) + "–" + currency.format(max);
  }
  if (listing.priceMinor && listing.currencyCode === "NGN") {
    return currency.format(listing.priceMinor / 100);
  }
  return "Price confirmed by request";
}

function availabilitySummary(listing: Listing) {
  if (listing.availabilityWindows.includes("today")) {
    return "Today by enquiry";
  }
  if (listing.availabilityWindows.includes("tomorrow")) {
    return "Tomorrow by enquiry";
  }
  if (listing.availabilityWindows.includes("weekend")) {
    return "Weekend by enquiry";
  }
  return listing.availabilityNote || "Availability by enquiry";
}

export function ListingProfileExperience({
  action,
  category,
  isDirectOrderAvailable,
  listing,
  market,
  orderRecovery,
  relatedListings,
  requestRecovery,
  searchQuery,
  vendor,
}: ListingProfileExperienceProps) {
  const routeKey = getListingRouteKey(listing);
  const isDemo = listing.provenance?.kind === "fictional-demo";
  const coverImage = listingImage(listing);
  const normalizedQuery = normalizeSearchContext(searchQuery);
  const backHref = normalizedQuery
    ? "/" + market + "/search?q=" + encodeURIComponent(normalizedQuery)
    : "/" + market + "/search";
  const directionsHref =
    "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent(listing.location + ", Lafia");

  return (
    <div className={styles.page}>
      <div className={"container " + styles.shell}>
        <section className={styles.profile} aria-labelledby="listing-title">
          <div className={styles.hero}>
            {coverImage ? (
              <Image
                alt=""
                fill
                priority
                sizes="(max-width: 760px) 100vw, (max-width: 1100px) 60vw, 860px"
                src={coverImage}
              />
            ) : (
              <div className={styles.emptyCover}>
                <ImageIcon aria-hidden="true" size={34} />
                <span>No cover photo published</span>
              </div>
            )}
            <Link className={styles.backButton} href={backHref}>
              <ArrowLeft aria-hidden="true" size={23} />
              <span className="sr-only">Back to search results</span>
            </Link>
            <div className={styles.heroActions}>
              <ListingProfileActions title={listing.title} />
            </div>
            <span className={styles.provenanceBadge}>
              <Info aria-hidden="true" size={15} />
              {isDemo
                ? "Fictional LocalHub demo"
                : "Published directory listing"}
            </span>
          </div>

          <div className={styles.summary}>
            <p className={styles.categoryLine}>
              {category?.name || listing.category.replaceAll("-", " ")} ·{" "}
              {listing.location}
            </p>
            <h1 id="listing-title">{listing.title}</h1>
            <p className={styles.vendorLine}>
              <Store aria-hidden="true" size={18} />
              {vendor ? (
                <Link href={"/" + market + "/vendors/" + vendor.slug}>
                  {vendor.name}
                </Link>
              ) : (
                "Business profile"
              )}
            </p>

            <div className={styles.priceRow}>
              <strong>{formatPrice(listing)}</strong>
              <span>
                <Clock3 aria-hidden="true" size={16} />
                {availabilitySummary(listing)}
              </span>
            </div>

            <div
              className={styles.factStrip}
              aria-label="Published listing facts"
            >
              <span>
                <MapPin aria-hidden="true" size={18} />
                Published location
              </span>
              <span>
                <CalendarClock aria-hidden="true" size={18} />
                Confirm timing
              </span>
              <span>
                <ShieldCheck aria-hidden="true" size={18} />
                Commit after review
              </span>
            </div>

            <div className={styles.primaryActions}>
              {isDemo ? (
                <button disabled type="button">
                  Requests unavailable in demo
                </button>
              ) : (
                <div className={styles.commitmentAction}>
                  <CommitmentLink
                    action={action}
                    label={
                      action === "request-booking"
                        ? "Request availability"
                        : "Ask for a quote"
                    }
                    listing={routeKey}
                    market={market}
                    query={normalizedQuery}
                  />
                </div>
              )}
              {!isDemo && listing.location ? (
                <a
                  href={directionsHref}
                  referrerPolicy="no-referrer"
                  rel="noreferrer"
                  target="_blank"
                >
                  <Navigation aria-hidden="true" size={19} />
                  Directions
                </a>
              ) : (
                <Link href={backHref}>
                  <ArrowLeft aria-hidden="true" size={19} />
                  Results
                </Link>
              )}
            </div>
          </div>

          <div className={styles.content}>
            {relatedListings.length ? (
              <section aria-labelledby="related-listings-title">
                <div className={styles.sectionHeading}>
                  <div>
                    <p>Explore nearby options</p>
                    <h2 id="related-listings-title">Similar listings</h2>
                  </div>
                  <Link href={backHref}>View search</Link>
                </div>
                <div className={styles.relatedGrid}>
                  {relatedListings.map((related) => {
                    const relatedImage = listingImage(related);
                    const relatedRoute = getListingRouteKey(related);
                    const suffix = normalizedQuery
                      ? "?q=" + encodeURIComponent(normalizedQuery)
                      : "";
                    return (
                      <Link
                        className={styles.relatedCard}
                        href={
                          "/" + market + "/listings/" + relatedRoute + suffix
                        }
                        key={relatedRoute}
                      >
                        <span className={styles.relatedImage}>
                          {relatedImage ? (
                            <Image
                              alt=""
                              fill
                              sizes="(max-width: 760px) 43vw, 220px"
                              src={relatedImage}
                            />
                          ) : (
                            <ImageIcon aria-hidden="true" size={25} />
                          )}
                        </span>
                        <strong>{related.title}</strong>
                        <span>{formatPrice(related)}</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section
              className={styles.about}
              aria-labelledby="about-listing-title"
            >
              <p>About this listing</p>
              <h2 id="about-listing-title">What the business has published</h2>
              <p>
                {listing.description ||
                  vendor?.summary ||
                  "No public description has been added yet."}
              </p>
              {vendor?.summary && vendor.summary !== listing.description ? (
                <p>{vendor.summary}</p>
              ) : null}
            </section>

            <section
              className={styles.reviewState}
              aria-labelledby="review-state-title"
            >
              <MessageSquareText aria-hidden="true" size={28} />
              <div>
                <h2 id="review-state-title">Customer feedback</h2>
                <p>
                  LocalHub has not published customer ratings or reviews for
                  this listing. No score is estimated or inferred.
                </p>
              </div>
            </section>
          </div>
        </section>

        <aside
          className={styles.requestPanel}
          aria-labelledby="request-panel-title"
        >
          <p className={styles.panelLabel}>Direct request</p>
          <h2 id="request-panel-title">Need something specific?</h2>
          <p>
            Tell the business what you need. You can browse freely and sign in
            only when you are ready to send.
          </p>

          {requestRecovery ? (
            <p className={styles.alert} role="alert">
              {requestRecovery === "expired"
                ? "That saved request expired. You can safely start another request here."
                : "We could not continue that request. You can safely try again."}
            </p>
          ) : null}
          {orderRecovery ? (
            <p className={styles.alert} role="alert">
              {orderRecovery === "expired"
                ? "That saved order expired. Review the listing before starting again."
                : "We could not continue that order. Review the listing before retrying."}
            </p>
          ) : null}

          <ul>
            <li>
              <Clock3 aria-hidden="true" size={18} />
              Availability is confirmed by the business.
            </li>
            <li>
              <ShieldCheck aria-hidden="true" size={18} />A request is not an
              order, booking, or payment.
            </li>
            <li>
              <MessageSquareText aria-hidden="true" size={18} />
              You decide after the business responds.
            </li>
          </ul>

          {isDemo ? (
            <div className={styles.demoNotice} role="status">
              <strong>Browsing-only demonstration</strong>
              <span>
                Requests never reach a vendor from fictional demo listings.
              </span>
            </div>
          ) : (
            <div className={styles.panelCommitment}>
              <CommitmentLink
                action={action}
                label={
                  action === "request-booking"
                    ? "Request availability"
                    : "Ask for a quote"
                }
                listing={routeKey}
                market={market}
                query={normalizedQuery}
              />
            </div>
          )}

          {isDirectOrderAvailable ? (
            <section
              className={styles.orderPanel}
              aria-labelledby="order-panel-title"
            >
              <h3 id="order-panel-title">Ready to order?</h3>
              <p>The confirmed price is checked again before placement.</p>
              <OrderIntentForm listing={routeKey} market={market} />
            </section>
          ) : null}
        </aside>
      </div>

      <div className={styles.mobileCommitment}>
        <span>
          <strong>Need something custom?</strong>
          {isDemo ? "Demo browsing only" : "Send details to the business"}
        </span>
        {isDemo ? (
          <button disabled type="button">
            Unavailable
          </button>
        ) : (
          <CommitmentLink
            action={action}
            label="Ask for a quote"
            listing={routeKey}
            market={market}
            query={normalizedQuery}
          />
        )}
      </div>
    </div>
  );
}
