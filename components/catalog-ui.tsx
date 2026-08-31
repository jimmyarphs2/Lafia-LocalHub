import {
  BedDouble,
  Camera,
  HeartPulse,
  House,
  Laptop,
  MapPin,
  Scissors,
  ShoppingBag,
  Utensils,
  ArrowRight,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import {
  getCategoryRouteKey,
  getListingRouteKey,
  type CatalogState,
  type Category,
  type Listing,
} from "@/lib/catalog/data";
import type { ListingMatch } from "@/lib/matching/rank";
const icons: Record<string, typeof Camera> = {
  "food-restaurants": Utensils,
  fashion: ShoppingBag,
  electronics: Laptop,
  beauty: Scissors,
  "home-services": House,
  photography: Camera,
  "equipment-hire": Wrench,
  hotels: BedDouble,
  health: HeartPulse,
};

const categoryLabel = (category: string) =>
  category ? category.replaceAll("-", " ") : "local listing";

const locationLabel = (location: string) =>
  location || "Location not published";

export function CatalogStateNotice({
  state,
  subject = "directory",
}: {
  state: Exclude<CatalogState, "ready">;
  subject?: string;
}) {
  const unpublished = state === "market-unpublished";

  return (
    <div className="empty-state" data-catalog-state={state}>
      <h2>
        {unpublished
          ? `No verified ${subject} is published for this market yet.`
          : `The verified ${subject} is temporarily unavailable.`}
      </h2>
      <p>
        {unpublished
          ? "LocalHub will show records here only after the market and its directory data are published."
          : "No fictional, cached, or unverified business records are substituted when the live catalog cannot be read."}
      </p>
    </div>
  );
}
export function CategoryTiles({
  market,
  categories,
}: {
  market: string;
  categories: readonly Category[];
}) {
  return (
    <div className="category-grid">
      {categories.map((category) => {
        const Icon = icons[category.slug] ?? HeartPulse;
        return (
          <Link
            className="category-tile"
            href={`/${market}/categories/${getCategoryRouteKey(category)}`}
            key={getCategoryRouteKey(category)}
          >
            <Icon aria-hidden="true" size={38} />
            <span>{category.name}</span>
          </Link>
        );
      })}
    </div>
  );
}
export function ListingCard({
  market,
  listing,
}: {
  market: string;
  listing: Listing;
}) {
  const isFictionalDemo = listing.provenance?.kind === "fictional-demo";

  return (
    <article className="listing-card">
      <div
        aria-hidden="true"
        className="listing-visual"
        style={{ "--listing-color": listing.color } as React.CSSProperties}
      />
      <div className="listing-content">
        <p className="listing-kind">{categoryLabel(listing.category)}</p>
        <h3>
          <Link href={`/${market}/listings/${getListingRouteKey(listing)}`}>
            {listing.title}
          </Link>
        </h3>
        <p className="listing-meta">
          <MapPin aria-hidden="true" size={14} />
          {locationLabel(listing.location)}
        </p>
        <span className="demo-label">
          {isFictionalDemo ? "Fictional demo listing" : "Directory listing"}
        </span>
      </div>
    </article>
  );
}

const listingHref = (market: string, listing: Listing, query?: string) =>
  `/${market}/listings/${getListingRouteKey(listing)}${query ? `?q=${encodeURIComponent(query)}` : ""}`;

const listingCategoryLabel = (listing: Listing) =>
  categoryLabel(listing.category);

const listingLocationLabel = (listing: Listing) =>
  locationLabel(listing.location);

export function ListingRows({
  market,
  listings,
  query,
}: {
  market: string;
  listings: readonly Listing[];
  query?: string;
}) {
  return (
    <div className="results-list">
      {listings.map((listing) => (
        <article className="result-row" key={getListingRouteKey(listing)}>
          <div
            aria-hidden="true"
            className="result-swatch"
            style={{ "--listing-color": listing.color } as React.CSSProperties}
          />
          <div>
            <p className="listing-kind">
              {listingCategoryLabel(listing)} · {listingLocationLabel(listing)}
            </p>
            <h3>
              <Link href={listingHref(market, listing, query)}>
                {listing.title}
              </Link>
            </h3>
            <p>
              {listing.description ||
                "This listing has not added a public description yet."}
            </p>
          </div>
          <Link
            className="button button-secondary"
            href={listingHref(market, listing, query)}
          >
            View <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </article>
      ))}
    </div>
  );
}

export function ListingMatchRows({
  market,
  matches,
  query,
}: {
  market: string;
  matches: readonly ListingMatch[];
  query: string;
}) {
  return (
    <div className="results-list">
      {matches.map((match) => {
        const listing = match.listing;
        const isFictionalDemo = listing.provenance?.kind === "fictional-demo";
        const reasons = match.components.filter(
          (component) =>
            component.score !== null && component.dimension !== "relevance",
        );
        return (
          <article
            className="result-row match-result-row"
            key={getListingRouteKey(listing)}
          >
            <div
              aria-hidden="true"
              className="result-swatch"
              style={
                { "--listing-color": listing.color } as React.CSSProperties
              }
            />
            <div>
              <p className="listing-kind">
                {listingCategoryLabel(listing)} ·{" "}
                {listingLocationLabel(listing)}
              </p>
              <h3>
                <Link href={listingHref(market, listing, query)}>
                  {listing.title}
                </Link>
              </h3>
              <p>
                {listing.description ||
                  "This listing has not added a public description yet."}
              </p>
              <div className="match-summary">
                <span className="match-score">
                  <strong>{match.score}</strong>/100 · {match.band}
                </span>
                <span className="demo-label">
                  {isFictionalDemo
                    ? "Fictional demo evidence"
                    : "Listing evidence"}
                </span>
              </div>
              {reasons.length > 0 && (
                <ul className="match-reasons">
                  {reasons.slice(0, 3).map((component) => (
                    <li key={component.dimension}>{component.reason}</li>
                  ))}
                </ul>
              )}
              <p className="match-score-notice">{match.scoreNotice}</p>
            </div>
            <Link
              className="button button-secondary"
              href={listingHref(market, listing, query)}
            >
              View <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </article>
        );
      })}
    </div>
  );
}
