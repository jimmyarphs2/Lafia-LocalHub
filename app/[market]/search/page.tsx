import { CatalogStateNotice } from "@/components/catalog-ui";
import { normalizeSearchContext } from "@/components/commitment-link";
import { SearchResultsExperience } from "@/components/search-results-experience";
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

  if (catalog.state !== "ready") {
    return (
      <section className="container section">
        <CatalogStateNotice state={catalog.state} subject="directory" />
      </section>
    );
  }

  return (
    <SearchResultsExperience
      categories={catalog.categories}
      demandPath={demandPath}
      demoMode={demoMode}
      interpretedQuery={derived ? `Interpreted as ${derived}` : undefined}
      market={market}
      marketName={
        catalog.market?.name ?? (market === "lafia" ? "Lafia" : market)
      }
      matches={matches}
      query={raw}
    />
  );
}
