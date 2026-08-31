import "server-only";

import {
  categories,
  listings,
  vendors,
  type CatalogLocation,
  type CatalogState,
  type Category,
  type Listing,
  type Vendor,
} from "@/lib/catalog/data";
import {
  getPublicCatalog,
  type PublicCatalogMarket,
} from "@/lib/catalog/public-catalog";
import { isDemoMode } from "@/lib/market/public-url";

export type CatalogSnapshot = {
  state: CatalogState;
  source: "fictional-demo" | "supabase";
  complete: boolean;
  market?: PublicCatalogMarket;
  categories: readonly Category[];
  locations: readonly CatalogLocation[];
  vendors: readonly Vendor[];
  listings: readonly Listing[];
};

const DEMO_SNAPSHOT = Object.freeze({
  state: "ready" as const,
  source: "fictional-demo" as const,
  complete: true,
  categories,
  locations: [] as readonly CatalogLocation[],
  vendors,
  listings,
});

/** Select exactly one catalog source; demo records never fall through to live mode. */
export async function getCatalogForMarket(
  marketSlug: string,
): Promise<CatalogSnapshot> {
  if (isDemoMode()) return DEMO_SNAPSHOT;
  return getPublicCatalog(marketSlug);
}
