import { Lightbulb } from "lucide-react";
import Link from "next/link";
import {
  CatalogStateNotice,
  ListingMatchRows,
  ListingRows,
} from "@/components/catalog-ui";
import { normalizeSearchContext } from "@/components/commitment-link";
import { SearchForm } from "@/components/search-form";
import { getCategoryRouteKey } from "@/lib/catalog/data";
import { getCatalogForMarket } from "@/lib/catalog/source";
import { describeIntent, searchListings } from "@/lib/catalog/search";
import {
  demandConfirmationPath,
  deriveUnmetDemandCaptureCandidate,
} from "@/lib/demand/contract";
export default async function SearchPage({
  params,
  searchParams,
}: PageProps<"/[market]/search">) {
  const [{ market }, query] = await Promise.all([params, searchParams]);
  const raw = normalizeSearchContext(
    typeof query.q === "string" ? query.q : "",
  );
  const catalog = await getCatalogForMarket(market);
  const demoMode = catalog.source === "fictional-demo";
  const { intent, results, matches } = searchListings(
    raw,
    market,
    catalog.state === "ready" ? catalog.listings : [],
    catalog.source === "supabase"
      ? { categories: catalog.categories, locations: catalog.locations }
      : { categories: catalog.categories },
  );
  const derived = describeIntent(intent);
  const demandCandidate = deriveUnmetDemandCaptureCandidate({
    source: catalog.source,
    state: catalog.state,
    complete: catalog.complete,
    market: catalog.market,
    categories: catalog.categories,
    listings: catalog.listings,
    intent,
    resultCount: results.length,
  });
  const demandPath = demandCandidate
    ? demandConfirmationPath(
        demandCandidate.marketSlug,
        demandCandidate.categoryId,
      )
    : null;
  return (
    <>
      <header className="directory-header">
        <div className="container">
          <h1>{raw ? `Results for “${raw}”` : "Search the directory"}</h1>
          {derived && (
            <p className="lede" style={{ marginLeft: 0 }}>
              Interpreted as: {derived}
            </p>
          )}
          <SearchForm market={market} defaultValue={raw} />
        </div>
      </header>
      <div className="container result-layout">
        <aside className="filters" aria-label="Browse categories">
          <div className="filter-group">
            <p>Categories</p>
            {catalog.categories.map((category) => (
              <Link
                key={getCategoryRouteKey(category)}
                href={`/${market}/categories/${getCategoryRouteKey(category)}`}
              >
                {category.name}
              </Link>
            ))}
          </div>
          <div className="filter-group">
            <p>About this search</p>
            <span className="listing-meta">
              Natural-language terms help filter the{" "}
              {demoMode ? "fictional demo" : "verified"} directory. Matching
              uses deterministic category, availability, approximate distance,
              and price-range rules. It does not call AI or live maps.
            </span>
          </div>
        </aside>
        <section>
          {results.length ? (
            <>
              <p className="listing-meta">
                {results.length} matching{" "}
                {demoMode ? "fictional demo" : "verified"}{" "}
                {results.length === 1 ? "listing" : "listings"}.
              </p>
              <h2 className="results-heading">
                {raw ? "Ranked directory matches" : "Directory listings"}
              </h2>
              {raw ? (
                <>
                  <p className="match-method-note">
                    Match scores are whole-number product signals, not
                    probabilities or endorsements. Merchant ratings are excluded
                    because no verified rating evidence exists
                    {demoMode ? " in the demo data" : ""}; remaining evidence
                    weights are renormalized.
                  </p>
                  <ListingMatchRows
                    market={market}
                    matches={matches}
                    query={raw}
                  />
                </>
              ) : (
                <ListingRows market={market} listings={results} />
              )}
            </>
          ) : catalog.state !== "ready" ? (
            <CatalogStateNotice state={catalog.state} subject="directory" />
          ) : (
            <div className="empty-state">
              <Lightbulb aria-hidden="true" size={30} color="#2350f4" />
              <h2>
                We do not have a matching {demoMode ? "demo" : "verified"}{" "}
                listing yet.
              </h2>
              <p>
                {!raw
                  ? "No verified listings are published in this market yet."
                  : demandPath
                    ? "This recognized category currently has no published supply. You can explicitly record one private daily category-gap marker after signing in."
                    : demoMode
                      ? "Fictional demo searches never create operational demand records."
                      : "Try a broader category or fewer details. LocalHub records a supply gap only when one verified category has no published listing."}
              </p>
              {demandPath ? (
                <a
                  className="button button-primary"
                  href={demandPath}
                  referrerPolicy="no-referrer"
                  rel="noreferrer"
                >
                  Review category-gap record
                </a>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
