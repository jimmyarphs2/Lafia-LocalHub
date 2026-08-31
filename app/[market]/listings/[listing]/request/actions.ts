"use server";

import { redirect } from "next/navigation";

import {
  listingRouteSchema,
  marketSlugSchema,
  requestDetailsSchema,
  requestIntentIdSchema,
} from "@/lib/requests/contract";
import {
  createListingRequestFromIntent,
  getListingRequestIntent,
} from "@/lib/requests/rpc";
import { getServerSupabaseClient } from "@/lib/supabase/server";

function text(value: FormDataEntryValue | null, maximumLength: number) {
  return typeof value === "string" && value.length <= maximumLength
    ? value
    : null;
}

/** Auth and route/context authorization are repeated here because server actions are direct POST endpoints. */
export async function submitListingRequest(formData: FormData) {
  const market = marketSlugSchema.safeParse(text(formData.get("market"), 80));
  const listingRoute = listingRouteSchema.safeParse(
    text(formData.get("listing_route"), 201),
  );
  const intentId = requestIntentIdSchema.safeParse(formData.get("intent_id"));
  const details = requestDetailsSchema.safeParse(formData.get("details") ?? "");
  if (
    !market.success ||
    !listingRoute.success ||
    !intentId.success ||
    !details.success
  )
    redirect("/");

  const fallback = `/${market.data}/listings/${listingRoute.data}`;
  const client = await getServerSupabaseClient();
  const user =
    client && (await client.auth.getUser().catch(() => null))?.data.user;
  if (!client || !user) {
    redirect(
      `/auth?next=${encodeURIComponent(`${fallback}/request?intent=${intentId.data}`)}`,
    );
  }
  const intent = await getListingRequestIntent(client, intentId.data).catch(
    () => null,
  );
  if (
    !intent?.context ||
    intent.context.marketSlug !== market.data ||
    intent.context.listingRoute !== listingRoute.data
  ) {
    redirect(`${fallback}?request=unavailable`);
  }
  if (intent.context.existingRequestId) {
    redirect(`/${market.data}/requests/${intent.context.existingRequestId}`);
  }
  if (Date.parse(intent.context.expiresAt) <= Date.now()) {
    redirect(`${fallback}?request=unavailable`);
  }
  const created = await createListingRequestFromIntent(
    client,
    intentId.data,
    details.data,
  ).catch(() => ({ request: null, error: true }));
  if (!created.request || created.error) {
    redirect(
      `${fallback}/request?intent=${encodeURIComponent(intentId.data)}&error=unavailable`,
    );
  }
  redirect(`/${market.data}/requests/${created.request.id}`);
}
