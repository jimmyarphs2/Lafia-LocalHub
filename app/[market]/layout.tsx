import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { CatalogStateNotice } from "@/components/catalog-ui";
import { MarketShell } from "@/components/market-shell";
import type { CatalogState } from "@/lib/catalog/data";
import { getCatalogForMarket } from "@/lib/catalog/source";
import { getMarket, markets, type Market } from "@/lib/market/config";
import { getPublicUrl, isDemoMode } from "@/lib/market/public-url";

type MarketResolution = { market?: Market; state: CatalogState };

const resolveRouteMarket = cache(
  async (slug: string): Promise<MarketResolution> => {
    const knownMarket = getMarket(slug);
    if (knownMarket) return { market: knownMarket, state: "ready" };
    if (
      isDemoMode() ||
      slug.length > 80 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    ) {
      return { state: "market-unpublished" };
    }

    // Validate this exact market through the existing public catalog, rather
    // than treating a capped entry-directory list as a global allow-list.
    const catalog = await getCatalogForMarket(slug);
    const published = catalog.market;
    if (!published) {
      return {
        state: catalog.state === "ready" ? "unavailable" : catalog.state,
      };
    }
    const name = published.name.trim();
    if (published.slug !== slug || !name || name.length > 120) {
      return { state: "unavailable" };
    }
    return {
      state: "ready",
      market: {
        slug: published.slug,
        name,
        region: "",
        country: /^[A-Z]{2}$/.test(published.countryCode)
          ? (new Intl.DisplayNames(["en"], { type: "region" }).of(
              published.countryCode,
            ) ?? published.countryCode)
          : "",
        description: `Discover published local businesses in ${name}.`,
      },
    };
  },
);

export function generateStaticParams() {
  return markets.map(({ slug }) => ({ market: slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ market: string }>;
}): Promise<Metadata> {
  const { market: slug } = await params;
  const { market, state } = await resolveRouteMarket(slug);
  if (!market) {
    return state === "market-unpublished"
      ? {}
      : {
          title: "Directory temporarily unavailable",
          robots: { index: false, follow: false },
        };
  }
  return {
    title: `${market.name} directory`,
    description: isDemoMode()
      ? `Browse LocalHub’s fictional ${market.name} directory demonstration.`
      : `Browse published businesses in LocalHub’s ${market.name} directory.`,
    alternates: { canonical: getPublicUrl(`/${market.slug}`) },
  };
}
export default async function Layout({
  children,
  params,
}: LayoutProps<"/[market]">) {
  const { market: slug } = await params;
  const { market, state } = await resolveRouteMarket(slug);
  if (!market) {
    if (state === "market-unpublished") notFound();
    return (
      <main className="section container" id="main-content">
        <h1>LocalHub directory</h1>
        <CatalogStateNotice state={state === "ready" ? "unavailable" : state} />
        <Link className="text-link" href="/">
          Back to LocalHub
        </Link>
      </main>
    );
  }
  return <MarketShell market={market}>{children}</MarketShell>;
}
