"use client";

import {
  Bookmark,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Grid2X2,
  List,
  Map,
  MapPin,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { getListingRouteKey, type Category } from "@/lib/catalog/data";
import type { ListingMatch } from "@/lib/matching/rank";

import styles from "./search-results-experience.module.css";

type SearchResultsExperienceProps = {
  market: string;
  marketName: string;
  query: string;
  interpretedQuery?: string;
  matches: readonly ListingMatch[];
  categories: readonly Category[];
  demoMode: boolean;
  demandPath: string | null;
};

type SortMode = "match" | "price" | "name";
type ViewMode = "list" | "map";

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

function formatPrice(match: ListingMatch) {
  const range = match.listing.priceRangeNaira;
  if (range) {
    return range.min === range.max
      ? currency.format(range.min)
      : `${currency.format(range.min)} – ${currency.format(range.max)}`;
  }
  if (match.listing.priceMinor && match.listing.currencyCode === "NGN") {
    return currency.format(match.listing.priceMinor / 100);
  }
  return "Ask for current price";
}

function categoryName(match: ListingMatch, categories: readonly Category[]) {
  return (
    categories.find(
      (category) =>
        (match.listing.categoryId &&
          category.id === match.listing.categoryId) ||
        category.slug === match.listing.category,
    )?.name ?? match.listing.category.replaceAll("-", " ")
  );
}

function availabilityLabel(match: ListingMatch) {
  const windows = match.listing.availabilityWindows;
  if (windows.includes("today")) return "Today by enquiry";
  if (windows.includes("tomorrow")) return "Tomorrow by enquiry";
  if (windows.includes("weekend")) return "Weekend by enquiry";
  return match.listing.availabilityNote || "Availability by enquiry";
}

function minimumPrice(match: ListingMatch) {
  return (
    match.listing.priceRangeNaira?.min ??
    (match.listing.priceMinor ? match.listing.priceMinor / 100 : Infinity)
  );
}

export function SearchResultsExperience({
  market,
  marketName,
  query,
  interpretedQuery,
  matches,
  categories,
  demoMode,
  demandPath,
}: SearchResultsExperienceProps) {
  const [searchValue, setSearchValue] = useState(query);
  const [category, setCategory] = useState("all");
  const [area, setArea] = useState("all");
  const [price, setPrice] = useState("all");
  const [availability, setAvailability] = useState("all");
  const [sort, setSort] = useState<SortMode>("match");
  const [view, setView] = useState<ViewMode>("list");
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const [showMethod, setShowMethod] = useState(false);

  const areas = useMemo(
    () =>
      Array.from(
        new Set(matches.map(({ listing }) => listing.location).filter(Boolean)),
      ).sort((left, right) => left.localeCompare(right)),
    [matches],
  );

  const visibleMatches = useMemo(() => {
    const next = matches.filter((match) => {
      const listing = match.listing;
      const inCategory =
        category === "all" ||
        listing.categoryId === category ||
        listing.category === category;
      const inArea = area === "all" || listing.location === area;
      const inPrice =
        price === "all" ||
        (price === "under-10000" && minimumPrice(match) < 10_000) ||
        (price === "10000-25000" && minimumPrice(match) <= 25_000) ||
        (price === "over-25000" && minimumPrice(match) > 25_000);
      const inAvailability =
        availability === "all" ||
        listing.availabilityWindows.includes(
          availability as (typeof listing.availabilityWindows)[number],
        );
      return inCategory && inArea && inPrice && inAvailability;
    });

    if (sort === "price") {
      return next.toSorted(
        (left, right) => minimumPrice(left) - minimumPrice(right),
      );
    }
    if (sort === "name") {
      return next.toSorted((left, right) =>
        left.listing.title.localeCompare(right.listing.title),
      );
    }
    return next;
  }, [area, availability, category, matches, price, sort]);

  const hasFilters =
    category !== "all" ||
    area !== "all" ||
    price !== "all" ||
    availability !== "all";

  const clearFilters = () => {
    setCategory("all");
    setArea("all");
    setPrice("all");
    setAvailability("all");
  };

  const toggleSaved = (routeKey: string) => {
    setSaved((current) => {
      const next = new Set(current);
      if (next.has(routeKey)) next.delete(routeKey);
      else next.add(routeKey);
      return next;
    });
  };

  return (
    <div className={styles.page}>
      <section className={styles.searchBand}>
        <div className={`container ${styles.searchContainer}`}>
          <form
            action={`/${market}/search`}
            className={styles.searchForm}
            role="search"
          >
            <Search aria-hidden="true" size={24} />
            <label className="sr-only" htmlFor="results-search">
              Search the {marketName} directory
            </label>
            <input
              autoComplete="off"
              id="results-search"
              name="q"
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder={`Ask for anything in ${marketName}…`}
              value={searchValue}
            />
            {searchValue ? (
              <button
                aria-label="Clear search"
                className={styles.clearSearch}
                onClick={() => setSearchValue("")}
                type="button"
              >
                <X aria-hidden="true" size={21} />
              </button>
            ) : null}
            <button className={styles.submitSearch} type="submit">
              <Search aria-hidden="true" size={20} />
              <span>Search</span>
            </button>
          </form>
        </div>
      </section>

      <div className={`container ${styles.layout}`}>
        <aside className={styles.filterRail} aria-label="Search filters">
          <div className={styles.filterTitleRow}>
            <h2>
              <SlidersHorizontal aria-hidden="true" size={20} /> Filters
            </h2>
            <button disabled={!hasFilters} onClick={clearFilters} type="button">
              Clear
            </button>
          </div>
          <FilterSelect
            icon={<Grid2X2 aria-hidden="true" size={18} />}
            id="category-filter"
            label="Category"
            onChange={setCategory}
            value={category}
          >
            <option value="all">All categories</option>
            {categories.map((item) => (
              <option key={item.id ?? item.slug} value={item.id ?? item.slug}>
                {item.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            icon={<MapPin aria-hidden="true" size={18} />}
            id="area-filter"
            label="Distance"
            onChange={setArea}
            value={area}
          >
            <option value="all">Any published area</option>
            {areas.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            id="price-filter"
            label="Price"
            onChange={setPrice}
            value={price}
          >
            <option value="all">Any price</option>
            <option value="under-10000">Under ₦10,000</option>
            <option value="10000-25000">Up to ₦25,000</option>
            <option value="over-25000">Above ₦25,000</option>
          </FilterSelect>
          <FilterSelect
            icon={<Clock3 aria-hidden="true" size={18} />}
            id="availability-filter"
            label="Available"
            onChange={setAvailability}
            value={availability}
          >
            <option value="all">Any time</option>
            <option value="today">Today</option>
            <option value="tomorrow">Tomorrow</option>
            <option value="weekend">Weekend</option>
            <option value="on-request">On request</option>
          </FilterSelect>
        </aside>

        <section
          aria-labelledby="search-results-heading"
          className={styles.results}
        >
          <div className={styles.resultHeader}>
            <div>
              <p className={styles.resultCount} aria-live="polite">
                {visibleMatches.length}{" "}
                {visibleMatches.length === 1 ? "match" : "matches"}
              </p>
              <h1 id="search-results-heading">
                {query ? `Results for “${query}”` : `Explore ${marketName}`}
              </h1>
              {interpretedQuery ? (
                <p className={styles.interpretation}>{interpretedQuery}</p>
              ) : null}
            </div>
            <div className={styles.resultTools}>
              <label className={styles.sortControl}>
                <span>Sort</span>
                <select
                  aria-label="Sort results"
                  onChange={(event) => setSort(event.target.value as SortMode)}
                  value={sort}
                >
                  <option value="match">Best match</option>
                  <option value="price">Lowest price</option>
                  <option value="name">Name</option>
                </select>
                <ChevronDown aria-hidden="true" size={16} />
              </label>
              <div className={styles.viewSwitch} aria-label="Results view">
                <button
                  aria-pressed={view === "list"}
                  className={view === "list" ? styles.activeView : undefined}
                  onClick={() => setView("list")}
                  type="button"
                >
                  <List aria-hidden="true" size={18} /> List
                </button>
                <button
                  aria-pressed={view === "map"}
                  className={view === "map" ? styles.activeView : undefined}
                  onClick={() => setView("map")}
                  type="button"
                >
                  <Map aria-hidden="true" size={18} /> Area
                </button>
              </div>
            </div>
          </div>

          <div className={styles.mobileFilters} aria-label="Quick filters">
            <CompactFilter label="Category" value={category}>
              <select
                aria-label="Filter by category"
                onChange={(event) => setCategory(event.target.value)}
                value={category}
              >
                <option value="all">All categories</option>
                {categories.map((item) => (
                  <option
                    key={item.id ?? item.slug}
                    value={item.id ?? item.slug}
                  >
                    {item.name}
                  </option>
                ))}
              </select>
            </CompactFilter>
            <CompactFilter label="Area" value={area}>
              <select
                aria-label="Filter by area"
                onChange={(event) => setArea(event.target.value)}
                value={area}
              >
                <option value="all">Any area</option>
                {areas.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </CompactFilter>
            <CompactFilter label="Price" value={price}>
              <select
                aria-label="Filter by price"
                onChange={(event) => setPrice(event.target.value)}
                value={price}
              >
                <option value="all">Any price</option>
                <option value="under-10000">Under ₦10,000</option>
                <option value="10000-25000">Up to ₦25,000</option>
                <option value="over-25000">Above ₦25,000</option>
              </select>
            </CompactFilter>
            <CompactFilter label="Available" value={availability}>
              <select
                aria-label="Filter by availability"
                onChange={(event) => setAvailability(event.target.value)}
                value={availability}
              >
                <option value="all">Any time</option>
                <option value="today">Today</option>
                <option value="tomorrow">Tomorrow</option>
                <option value="weekend">Weekend</option>
                <option value="on-request">On request</option>
              </select>
            </CompactFilter>
            {hasFilters ? (
              <button
                className={styles.resetChip}
                onClick={clearFilters}
                type="button"
              >
                <RotateCcw aria-hidden="true" size={16} /> Reset
              </button>
            ) : null}
          </div>

          {matches.length ? (
            visibleMatches.length ? (
              view === "list" ? (
                <div className={styles.resultList}>
                  {visibleMatches.map((match) => {
                    const listing = match.listing;
                    const routeKey = getListingRouteKey(listing);
                    const isSaved = saved.has(routeKey);
                    const isDemo =
                      listing.provenance?.kind === "fictional-demo";
                    const image = isDemo ? demoImages[listing.slug] : undefined;
                    return (
                      <article className={styles.resultCard} key={routeKey}>
                        <div className={styles.resultImage}>
                          {image ? (
                            <Image
                              alt=""
                              fill
                              sizes="(max-width: 760px) 42vw, (max-width: 1100px) 260px, 300px"
                              src={image}
                            />
                          ) : (
                            <MapPin aria-hidden="true" size={34} />
                          )}
                          <span className={styles.provenanceLabel}>
                            {isDemo ? "Fictional demo" : "Directory listing"}
                          </span>
                        </div>
                        <div className={styles.cardBody}>
                          <p className={styles.categoryLine}>
                            {categoryName(match, categories)} ·{" "}
                            {listing.location}
                          </p>
                          <h2>
                            <Link
                              href={`/${market}/listings/${routeKey}?q=${encodeURIComponent(query)}`}
                            >
                              {listing.title}
                            </Link>
                          </h2>
                          <p className={styles.price}>{formatPrice(match)}</p>
                          <div className={styles.evidenceLine}>
                            <span>
                              <MapPin aria-hidden="true" size={15} />{" "}
                              {listing.location}
                            </span>
                            <span>
                              <Clock3 aria-hidden="true" size={15} />{" "}
                              {availabilityLabel(match)}
                            </span>
                          </div>
                          <span className={styles.matchBand}>
                            <Check aria-hidden="true" size={14} /> {match.band}
                          </span>
                        </div>
                        <div className={styles.cardActions}>
                          <button
                            aria-label={
                              isSaved
                                ? "Remove saved listing"
                                : "Save listing for this view"
                            }
                            aria-pressed={isSaved}
                            className={styles.saveButton}
                            onClick={() => toggleSaved(routeKey)}
                            type="button"
                          >
                            <Bookmark
                              aria-hidden="true"
                              fill={isSaved ? "currentColor" : "none"}
                              size={21}
                            />
                          </button>
                          <Link
                            className={styles.viewButton}
                            href={`/${market}/listings/${routeKey}?q=${encodeURIComponent(query)}`}
                          >
                            View
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.areaView} role="tabpanel">
                  <Map aria-hidden="true" size={36} />
                  <h2>Results by published area</h2>
                  <p>
                    This is an area overview, not live navigation. Open a
                    listing for its published location details.
                  </p>
                  <div>
                    {areas.map((item) => {
                      const count = visibleMatches.filter(
                        ({ listing }) => listing.location === item,
                      ).length;
                      return count ? (
                        <button
                          key={item}
                          onClick={() => {
                            setArea(item);
                            setView("list");
                          }}
                          type="button"
                        >
                          <MapPin aria-hidden="true" size={18} />
                          <span>
                            <strong>{item}</strong>
                            {count} {count === 1 ? "result" : "results"}
                          </span>
                        </button>
                      ) : null;
                    })}
                  </div>
                </div>
              )
            ) : (
              <div className={styles.emptyState}>
                <Search aria-hidden="true" size={32} />
                <h2>No results match these filters.</h2>
                <p>Try a broader area, price, or availability option.</p>
                <button onClick={clearFilters} type="button">
                  Clear filters
                </button>
              </div>
            )
          ) : (
            <div className={styles.emptyState}>
              <Search aria-hidden="true" size={32} />
              <h2>
                No {demoMode ? "fictional demo" : "published"} listing matches
                yet.
              </h2>
              <p>Try a broader category or fewer details.</p>
              {demandPath ? (
                <a
                  href={demandPath}
                  referrerPolicy="no-referrer"
                  rel="noreferrer"
                >
                  Review category-gap record
                </a>
              ) : null}
            </div>
          )}

          {matches.length ? (
            <section className={styles.methodPanel}>
              <button
                aria-expanded={showMethod}
                onClick={() => setShowMethod((current) => !current)}
                type="button"
              >
                <CircleHelp aria-hidden="true" size={22} />
                <span>
                  <strong>How matches are ranked</strong>Rule-based fit from
                  published listing details.
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={showMethod ? styles.rotated : undefined}
                  size={19}
                />
              </button>
              {showMethod ? (
                <p>
                  Category, request terms, availability, approximate area, and
                  price evidence are compared deterministically. Scores are not
                  probabilities, endorsements, ratings, or guarantees.
                </p>
              ) : null}
            </section>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function FilterSelect({
  children,
  icon,
  id,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  icon?: ReactNode;
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className={styles.filterControl} htmlFor={id}>
      <span>{label}</span>
      <div>
        {icon}
        {!icon ? (
          <span aria-hidden="true" className={styles.nairaIcon}>
            ₦
          </span>
        ) : null}
        <select
          id={id}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          {children}
        </select>
        <ChevronDown aria-hidden="true" size={17} />
      </div>
    </label>
  );
}

function CompactFilter({
  children,
  label,
  value,
}: {
  children: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <label className={value !== "all" ? styles.activeChip : undefined}>
      <span>{label}</span>
      {children}
      <ChevronDown aria-hidden="true" size={15} />
    </label>
  );
}
