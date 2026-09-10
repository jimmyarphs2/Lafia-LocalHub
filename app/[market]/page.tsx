import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import {
  CatalogStateNotice,
  CategoryTiles,
  ListingCard,
} from "@/components/catalog-ui";
import { SearchForm } from "@/components/search-form";
import { getCategoryRouteKey, getListingRouteKey } from "@/lib/catalog/data";
import { getCatalogForMarket } from "@/lib/catalog/source";
const examples = [
  { label: "Birthday cake", query: "Birthday cake around Shendam Road" },
  { label: "Phone repair", query: "Phone repair near me" },
  { label: "Event photographer", query: "Event photographer in Lafia" },
  { label: "Dinner tonight", query: "Quiet restaurant for dinner tonight" },
  { label: "Generator hire", query: "30KVA generator around Lafia" },
];

const featuredCategories = [
  "food-restaurants",
  "photography",
  "equipment-hire",
] as const;
export default async function MarketHome({ params }: PageProps<"/[market]">) {
  const { market } = await params;
  const catalog = await getCatalogForMarket(market);
  const demoMode = catalog.source === "fictional-demo";
  const marketName =
    catalog.market?.name ?? (market === "lafia" ? "Lafia" : market);
  const preferredListings = featuredCategories
    .map((category) =>
      catalog.listings.find((listing) => listing.category === category),
    )
    .filter((listing) => listing !== undefined);
  const featuredListings = [
    ...preferredListings,
    ...catalog.listings.filter(
      (listing) => !preferredListings.includes(listing),
    ),
  ].slice(0, 3);
  return (
    <div className="localhub-home">
      <section className="hero localhub-home-hero">
        {demoMode ? (
          <div aria-hidden="true" className="home-hero-image" />
        ) : null}
        <div className="container hero-content">
          <p className="home-location-pill">Local discovery · {marketName}</p>
          <h1>Your city, one request away.</h1>
          <p className="lede">
            Find products, services, and local businesses—or simply describe
            what you need. Browse{" "}
            {demoMode
              ? "fictional directory examples made for testing."
              : "published options around you."}
          </p>
          <SearchForm market={market} />
          <nav className="query-examples" aria-label="Quick searches">
            {examples.map((example) => (
              <Link
                key={example.label}
                href={`/${market}/search?q=${encodeURIComponent(example.query)}`}
              >
                <Sparkles aria-hidden="true" size={14} />
                {example.label}
              </Link>
            ))}
          </nav>
          <p className="home-guest-note">
            Browse freely. Sign in only when you’re ready to act.
          </p>
        </div>
      </section>
      <section className="section container home-categories">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Explore the city</p>
            <h2>What are you looking for?</h2>
            <p>
              Browse the {demoMode ? "demo" : "local"} directory by category.
            </p>
          </div>
          <Link
            className="text-link"
            href={
              catalog.categories[0]
                ? `/${market}/categories/${getCategoryRouteKey(catalog.categories[0])}`
                : `/${market}/search`
            }
          >
            Browse directory <ArrowRight aria-hidden="true" size={17} />
          </Link>
        </div>
        {catalog.state === "ready" ? (
          catalog.categories.length ? (
            <CategoryTiles market={market} categories={catalog.categories} />
          ) : (
            <div className="empty-state">
              <h2>No categories are published yet.</h2>
              <p>
                Categories will appear here after they are published for this
                market.
              </p>
            </div>
          )
        ) : (
          <CatalogStateNotice state={catalog.state} />
        )}
      </section>
      {catalog.state === "ready" ? (
        <section className="section section-alt">
          <div className="container home-listings">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Discover in {marketName}</p>
                <h2>{demoMode ? "Made for exploring" : "Published nearby"}</h2>
                <p>
                  {demoMode
                    ? "Fictional examples across different local needs—not popularity rankings."
                    : "Only publishable records appear here."}
                </p>
              </div>
              <Link className="text-link" href={`/${market}/search`}>
                Search all <ArrowRight aria-hidden="true" size={17} />
              </Link>
            </div>
            <div className="listing-grid">
              {featuredListings.map((listing) => (
                <ListingCard
                  key={getListingRouteKey(listing)}
                  market={market}
                  listing={listing}
                />
              ))}
              {!catalog.listings.length ? (
                <div className="empty-state">
                  <h3>No listings are published yet.</h3>
                  <p>
                    LocalHub will show a business here only after it is
                    published.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
