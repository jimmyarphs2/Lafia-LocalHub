import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DemandSubmitButton } from "@/components/demand-submit-button";
import { getCatalogForMarket } from "@/lib/catalog/source";
import {
  demandCategoryIdSchema,
  demandConfirmationPath,
} from "@/lib/demand/contract";
import { marketSlugSchema } from "@/lib/requests/contract";
import { getServerSupabaseClient } from "@/lib/supabase/server";

import { submitUnmetDemandObservation } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm category gap | LocalHub",
  robots: { index: false, follow: false },
};

export default async function DemandConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ market: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [routeParams, urlState] = await Promise.all([params, searchParams]);
  const market = marketSlugSchema.safeParse(routeParams.market);
  const categoryId = demandCategoryIdSchema.safeParse(
    typeof urlState.category === "string" ? urlState.category : null,
  );
  if (!market.success || !categoryId.success) redirect("/");

  const confirmationPath = demandConfirmationPath(market.data, categoryId.data);
  const [catalog, client] = await Promise.all([
    getCatalogForMarket(market.data),
    getServerSupabaseClient().catch(() => null),
  ]);
  const category = catalog.categories.find(
    (candidate) => candidate.id === categoryId.data,
  );
  const categoryIsCanonical =
    catalog.source === "supabase" &&
    catalog.state === "ready" &&
    catalog.complete &&
    catalog.market?.slug === market.data &&
    Boolean(category) &&
    (category?.marketId === null ||
      category?.marketId === catalog.market?.id) &&
    !catalog.listings.some((listing) => listing.categoryId === categoryId.data);
  if (!categoryIsCanonical || !category) {
    redirect(`/${market.data}/search?demand=unavailable`);
  }

  const account =
    client && (await client.auth.getUser().catch(() => null))?.data.user;
  if (!client || !account) {
    redirect(`/auth?next=${encodeURIComponent(confirmationPath)}`);
  }

  return (
    <div className="container section" aria-labelledby="demand-title">
      <p className="breadcrumbs">
        <Link href={`/${market.data}/search`}>Back to search</Link>
      </p>
      <section className="empty-state">
        <p className="eyebrow">Explicit demand evidence</p>
        <h1 id="demand-title">Record a {category.name} category gap</h1>
        <p>
          LocalHub will retain one private marker for this market, category, and
          market-local day. Your original search words and account identity are
          not placed in the demand record.
        </p>
        <p>
          This optional marker helps establish that verified supply was absent.
          It does not guarantee that a vendor will join, respond, or fulfil the
          need.
        </p>
        {urlState.error === "unavailable" ? (
          <p role="alert" tabIndex={-1}>
            We could not record this category gap. Supply may now be available,
            or the secure record boundary may be temporarily unavailable.
          </p>
        ) : null}
        <form action={submitUnmetDemandObservation} className="form-stack">
          <input name="market" type="hidden" value={market.data} />
          <input name="category_id" type="hidden" value={categoryId.data} />
          <DemandSubmitButton />
        </form>
      </section>
    </div>
  );
}
