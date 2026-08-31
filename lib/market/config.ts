export type Market = {
  slug: string;
  name: string;
  region: string;
  country: string;
  description: string;
};
export const markets: readonly Market[] = [
  {
    slug: "lafia",
    name: "Lafia",
    region: "Nasarawa State",
    country: "Nigeria",
    description: "The fictional LocalHub launch market demonstration.",
  },
] as const;
export function getLaunchMarket(): Market {
  return markets[0];
}
export function getMarket(slug: string): Market | undefined {
  return markets.find((market) => market.slug === slug);
}
