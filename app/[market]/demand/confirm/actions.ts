"use server";

import { redirect } from "next/navigation";

import { getCatalogForMarket } from "@/lib/catalog/source";
import {
  demandCategoryIdSchema,
  demandConfirmationPath,
} from "@/lib/demand/contract";
import { recordMyUnmetDemandZeroResult } from "@/lib/demand/rpc";
import { marketSlugSchema } from "@/lib/requests/contract";
import { getServerSupabaseClient } from "@/lib/supabase/server";

function singleFormValue(formData: FormData, key: string): string | null {
  const values = formData.getAll(key);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}

/** Repeats every trust check because a Server Action is a direct POST entry point. */
export async function submitUnmetDemandObservation(formData: FormData) {
  const market = marketSlugSchema.safeParse(
    singleFormValue(formData, "market"),
  );
  const categoryId = demandCategoryIdSchema.safeParse(
    singleFormValue(formData, "category_id"),
  );
  if (!market.success || !categoryId.success) redirect("/");

  const confirmationPath = demandConfirmationPath(market.data, categoryId.data);
  const client = await getServerSupabaseClient().catch(() => null);
  const account =
    client && (await client.auth.getUser().catch(() => null))?.data.user;
  if (!client || !account) {
    redirect(`/auth?next=${encodeURIComponent(confirmationPath)}`);
  }

  const catalog = await getCatalogForMarket(market.data);
  const category = catalog.categories.find(
    (candidate) => candidate.id === categoryId.data,
  );
  const contextIsCanonical =
    catalog.source === "supabase" &&
    catalog.state === "ready" &&
    catalog.complete &&
    catalog.market?.slug === market.data &&
    Boolean(category) &&
    (category?.marketId === null ||
      category?.marketId === catalog.market?.id) &&
    !catalog.listings.some((listing) => listing.categoryId === categoryId.data);
  if (!contextIsCanonical) {
    redirect(`${confirmationPath}&error=unavailable`);
  }

  const result = await recordMyUnmetDemandZeroResult(client, {
    marketSlug: market.data,
    categoryId: categoryId.data,
  }).catch(() => null);
  if (!result?.accepted) {
    redirect(`${confirmationPath}&error=unavailable`);
  }

  // Do not put a success claim in the URL: parameters are forgeable and the
  // RPC deliberately does not reveal whether this call inserted or replayed.
  redirect(`/${market.data}/search`);
}
