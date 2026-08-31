import type { MetadataRoute } from "next";
import { getCategoryRouteKey, getListingRouteKey } from "@/lib/catalog/data";
import { getCatalogForMarket } from "@/lib/catalog/source";
import { getLaunchMarket } from "@/lib/market/config";
import { getPublicAppUrl } from "@/lib/market/public-url";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const market = getLaunchMarket();
  const catalog = await getCatalogForMarket(market.slug);
  if (catalog.source === "fictional-demo" || catalog.state !== "ready") {
    return [];
  }
  const base = new URL(`/${market.slug}`, getPublicAppUrl()).toString();
  return [
    {
      url: getPublicAppUrl().toString(),
      changeFrequency: "weekly",
      priority: 1,
    },
    { url: base, changeFrequency: "weekly", priority: 0.9 },
    ...catalog.categories.map((item) => ({
      url: `${base}/categories/${getCategoryRouteKey(item)}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...catalog.vendors.map((item) => ({
      url: `${base}/vendors/${item.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...catalog.listings.map((item) => ({
      url: `${base}/listings/${getListingRouteKey(item)}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
