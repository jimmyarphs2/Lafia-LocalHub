import Link from "next/link";
import { redirect } from "next/navigation";

import { RequestSubmitButton } from "@/components/request-submit-button";
import {
  listingRouteSchema,
  marketSlugSchema,
  requestIntentIdSchema,
} from "@/lib/requests/contract";
import { getListingRequestIntent } from "@/lib/requests/rpc";
import { getServerSupabaseClient } from "@/lib/supabase/server";

import { submitListingRequest } from "./actions";

export const dynamic = "force-dynamic";

function actionLabel(action: "enquire" | "request-booking") {
  return action === "request-booking" ? "booking request" : "enquiry";
}

export default async function ListingRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ market: string; listing: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ market, listing: listingRoute }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  if (
    !marketSlugSchema.safeParse(market).success ||
    !listingRouteSchema.safeParse(listingRoute).success
  ) {
    redirect("/");
  }
  const intentId = requestIntentIdSchema.safeParse(
    typeof query.intent === "string" ? query.intent : null,
  );
  const fallback = `/${market}/listings/${listingRoute}`;
  if (!intentId.success) redirect(`${fallback}?request=unavailable`);

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
  const requestContext = intent?.context;
  if (
    !requestContext ||
    requestContext.marketSlug !== market ||
    requestContext.listingRoute !== listingRoute
  ) {
    redirect(`${fallback}?request=unavailable`);
  }
  if (requestContext.existingRequestId) {
    redirect(`/${market}/requests/${requestContext.existingRequestId}`);
  }

  return (
    <div className="container section" aria-labelledby="request-title">
      <p className="breadcrumbs">
        <Link href={fallback}>Back to {requestContext.listingTitle}</Link>
      </p>
      <section className="empty-state">
        <p className="eyebrow">Confirm your request</p>
        <h1 id="request-title">
          Send a {actionLabel(requestContext.requestedAction)}
        </h1>
        <p>
          This will save a LocalHub customer request for{" "}
          <strong>{requestContext.listingTitle}</strong> from{" "}
          {requestContext.vendorName}. Their authorized workspace can view it,
          but this does not confirm that they have seen or accepted it. It is
          not an order, payment, or booking confirmation.
        </p>
        {requestContext.searchContext ? (
          <p className="listing-meta">
            Your search context: {requestContext.searchContext}
          </p>
        ) : null}
        {query.error === "unavailable" ? (
          <p role="alert">We could not save that request. Please try again.</p>
        ) : null}
        <form action={submitListingRequest} className="form-stack">
          <input name="market" type="hidden" value={market} />
          <input name="listing_route" type="hidden" value={listingRoute} />
          <input name="intent_id" type="hidden" value={intentId.data} />
          <label htmlFor="request-details">
            Optional details for the vendor
          </label>
          <textarea
            aria-describedby="request-details-help"
            id="request-details"
            maxLength={2000}
            name="details"
            placeholder="For example, your preferred date or what you need."
            rows={5}
          />
          <p className="help" id="request-details-help">
            Maximum 2,000 characters. Do not include payment details.
          </p>
          <RequestSubmitButton />
        </form>
      </section>
    </div>
  );
}
