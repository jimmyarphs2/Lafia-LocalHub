import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BusinessTriageQueue } from "@/components/admin/business-triage-queue";
import styles from "@/components/admin/business-triage.module.css";
import {
  parseBusinessTriageSearchParams,
  SUPER_ADMIN_BUSINESS_TRIAGE_PAGE_SIZE,
  type ActiveAdminMarket,
  type BusinessTriageCursor,
} from "@/lib/admin/business-triage-contract";
import {
  getSuperAdminTriageAccess,
  listActiveAdminMarkets,
  listSuperAdminPendingBusinesses,
} from "@/lib/admin/business-triage-rpc";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Business triage | LocalHub operations",
  robots: { index: false, follow: false },
};

type BusinessReviewsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function selectedMarket(
  markets: ActiveAdminMarket[],
  marketSlug: string | null,
) {
  return marketSlug
    ? (markets.find((market) => market.slug === marketSlug) ?? null)
    : null;
}

function nextPageHref(marketSlug: string, cursor: BusinessTriageCursor | null) {
  if (!cursor) return null;
  const query = new URLSearchParams({
    market: marketSlug,
    afterMarketId: cursor.marketId,
    afterSubmittedAt: cursor.submittedAt,
    afterBusinessId: cursor.businessId,
  });
  return `/admin/business-reviews?${query.toString()}`;
}

function MarketNavigation({
  markets,
  selectedSlug,
}: {
  markets: ActiveAdminMarket[];
  selectedSlug: string | null;
}) {
  return (
    <nav aria-label="Business triage market" className={styles.marketNav}>
      {markets.map((market) => (
        <Link
          aria-current={market.slug === selectedSlug ? "page" : undefined}
          href={`/admin/business-reviews?market=${encodeURIComponent(market.slug)}`}
          key={market.id}
        >
          {market.name}
        </Link>
      ))}
    </nav>
  );
}

export default async function BusinessReviewsPage({
  searchParams,
}: BusinessReviewsPageProps) {
  const parsedSearch = parseBusinessTriageSearchParams(await searchParams);
  if (!parsedSearch) notFound();

  const client = await getServerSupabaseClient().catch(() => null);
  if (!client) redirect("/auth?next=%2Fadmin%2Fbusiness-reviews");

  const user = (await client.auth.getUser().catch(() => null))?.data.user;
  if (!user) redirect("/auth?next=%2Fadmin%2Fbusiness-reviews");

  const [access, marketResult] = await Promise.all([
    getSuperAdminTriageAccess(client).catch(() => ({
      allowed: false,
      error: true,
    })),
    listActiveAdminMarkets(client).catch(() => ({ markets: [], error: true })),
  ]);
  if (access.error || marketResult.error) {
    return (
      <section aria-labelledby="admin-triage-title">
        <div className={styles.pageHeading}>
          <p className="eyebrow">LocalHub operations</p>
          <h1 id="admin-triage-title">Business review triage</h1>
        </div>
        <p className={styles.unavailable} role="alert">
          Review queue is temporarily unavailable.
        </p>
      </section>
    );
  }
  if (!access.allowed) notFound();

  const market = selectedMarket(marketResult.markets, parsedSearch.marketSlug);
  if (parsedSearch.marketSlug && !market) notFound();
  if (
    parsedSearch.cursor &&
    (!market || parsedSearch.cursor.marketId !== market.id)
  ) {
    notFound();
  }

  const pageResult = market
    ? await listSuperAdminPendingBusinesses(client, {
        marketId: market.id,
        cursor: parsedSearch.cursor,
        limit: SUPER_ADMIN_BUSINESS_TRIAGE_PAGE_SIZE,
      }).catch(() => ({ page: null, error: true }))
    : { page: null, error: null };

  return (
    <section aria-labelledby="admin-triage-title">
      <div className={styles.pageHeading}>
        <p className="eyebrow">LocalHub operations</p>
        <h1 id="admin-triage-title">Business review triage</h1>
        <p>
          Choose one active market to inspect the oldest submitted businesses.
          This first command-centre slice is intentionally read-only.
        </p>
      </div>
      <p className={styles.boundaryNotice}>
        Approval, rejection, suspension, listing publication, payment and
        customer actions are unavailable here.
      </p>

      {marketResult.markets.length > 0 ? (
        <MarketNavigation
          markets={marketResult.markets}
          selectedSlug={market?.slug ?? null}
        />
      ) : (
        <p className={styles.marketEmpty} role="status">
          No active markets are available for review triage.
        </p>
      )}

      {market && pageResult.error ? (
        <p className={styles.unavailable} role="alert">
          Review queue is temporarily unavailable.
        </p>
      ) : null}
      {market && !pageResult.error && pageResult.page ? (
        <BusinessTriageQueue
          businesses={pageResult.page.businesses}
          nextHref={nextPageHref(market.slug, pageResult.page.nextCursor)}
        />
      ) : null}
    </section>
  );
}
