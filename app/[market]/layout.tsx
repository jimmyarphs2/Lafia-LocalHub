import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MarketShell } from "@/components/market-shell";
import { getMarket, markets } from "@/lib/market/config";
import { getPublicUrl, isDemoMode } from "@/lib/market/public-url";
export function generateStaticParams() {
  return markets.map(({ slug }) => ({ market: slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ market: string }>;
}): Promise<Metadata> {
  const { market: slug } = await params;
  const market = getMarket(slug);
  if (!market) return {};
  return {
    title: `${market.name} directory`,
    description: isDemoMode()
      ? `Browse LocalHub’s fictional ${market.name} directory demonstration.`
      : `Browse verified businesses in LocalHub’s ${market.name} directory.`,
    alternates: { canonical: getPublicUrl(`/${market.slug}`) },
  };
}
export default async function Layout({
  children,
  params,
}: LayoutProps<"/[market]">) {
  const { market: slug } = await params;
  const market = getMarket(slug);
  if (!market) notFound();
  return <MarketShell market={market}>{children}</MarketShell>;
}
