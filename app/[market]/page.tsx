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
  "I need a birthday cake around Shendam Road tomorrow for under ₦20,000.",
  "Phone repair near me",
  "I need a photographer for my introduction ceremony next Saturday. Budget ₦80,000.",
  "Quiet restaurant for dinner tonight",
  "30KVA generator around Lafia",
];
export default async function MarketHome({ params }: PageProps<"/[market]">) {
  const { market } = await params;
  const catalog = await getCatalogForMarket(market);
  const demoMode = catalog.source === "fictional-demo";
  const marketName =
    catalog.market?.name ?? (market === "lafia" ? "Lafia" : market);
  return (
    <>
      <section className="hero">
        <div className="container hero-content">
          <h1>What do you need in {marketName}?</h1>
          <p className="lede">
            Describe a product, service, or business. LocalHub helps you explore
            nearby{" "}
            {demoMode
              ? "fictional directory examples"
              : "verified local options"}
            .
          </p>
          <SearchForm market={market} />
          <div className="query-examples">
            {examples.map((example) => (
              <Link
                key={example}
                href={`/${market}/search?q=${encodeURIComponent(example)}`}
              >
                <Sparkles aria-hidden="true" size={14} />
                {example}
              </Link>
            ))}
          </div>
        </div>
      </section>
      <section className="section container">
        <div className="section-heading">
          <div>
            <h2>Explore {marketName}</h2>
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
              <h2>No verified categories are published yet.</h2>
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
          <div className="container">
            <div className="section-heading">
              <div>
                <h2>
                  {demoMode
                    ? "Directory examples"
                    : "Verified directory listings"}
                </h2>
                <p>
                  {demoMode
                    ? "These entries are sample data, not popularity rankings."
                    : "Only publishable, verified records appear here."}
                </p>
              </div>
              <Link className="text-link" href={`/${market}/search`}>
                Search all <ArrowRight aria-hidden="true" size={17} />
              </Link>
            </div>
            <div className="listing-grid">
              {catalog.listings.slice(0, 3).map((listing) => (
                <ListingCard
                  key={getListingRouteKey(listing)}
                  market={market}
                  listing={listing}
                />
              ))}
              {!catalog.listings.length ? (
                <div className="empty-state">
                  <h3>No verified listings are published yet.</h3>
                  <p>
                    LocalHub will show a business here only after verification.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
