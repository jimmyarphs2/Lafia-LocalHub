import { ArrowLeft, MessageSquareText, ShieldCheck } from "lucide-react";
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
import styles from "./listing-request.module.css";

export const dynamic = "force-dynamic";

function actionLabel(action: "enquire" | "request-booking") {
  return action === "request-booking"
    ? "availability request"
    : "quote request";
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
  const fallback = "/" + market + "/listings/" + listingRoute;
  if (!intentId.success) redirect(fallback + "?request=unavailable");

  const client = await getServerSupabaseClient();
  const user =
    client && (await client.auth.getUser().catch(() => null))?.data.user;
  if (!client || !user) {
    redirect(
      "/auth?next=" +
        encodeURIComponent(fallback + "/request?intent=" + intentId.data),
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
    redirect(fallback + "?request=unavailable");
  }
  if (requestContext.existingRequestId) {
    redirect("/" + market + "/requests/" + requestContext.existingRequestId);
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <Link className={styles.backLink} href={fallback}>
          <ArrowLeft aria-hidden="true" size={18} />
          Back to {requestContext.listingTitle}
        </Link>

        <div className={styles.layout}>
          <section
            className={styles.requestCard}
            aria-labelledby="request-title"
          >
            <p className={styles.eyebrow}>Secure request</p>
            <h1 id="request-title">
              Confirm your {actionLabel(requestContext.requestedAction)}
            </h1>
            <p className={styles.intro}>
              Add the detail the business needs to respond accurately. Nothing
              is ordered, booked, or paid for when you send this request.
            </p>

            <div className={styles.listingSummary}>
              <span className={styles.listingIcon}>
                <MessageSquareText aria-hidden="true" size={25} />
              </span>
              <span>
                <strong>{requestContext.listingTitle}</strong>
                <span>{requestContext.vendorName}</span>
              </span>
            </div>

            {requestContext.searchContext ? (
              <p className={styles.context}>
                From your search: {requestContext.searchContext}
              </p>
            ) : null}
            {query.error === "unavailable" ? (
              <p className={styles.alert} role="alert">
                We could not save that request. Please try again.
              </p>
            ) : null}

            <form action={submitListingRequest} className={styles.form}>
              <input name="market" type="hidden" value={market} />
              <input name="listing_route" type="hidden" value={listingRoute} />
              <input name="intent_id" type="hidden" value={intentId.data} />
              <label htmlFor="request-details">
                What should the business know?
              </label>
              <textarea
                aria-describedby="request-details-help"
                id="request-details"
                maxLength={2000}
                name="details"
                placeholder="For example: what you need, preferred date, quantity, delivery area, or questions about the price."
                rows={6}
              />
              <p className={styles.help} id="request-details-help">
                Maximum 2,000 characters. Do not include card or bank details.
              </p>
              <RequestSubmitButton />
            </form>

            <p className={styles.safetyNote}>
              <ShieldCheck aria-hidden="true" size={19} />
              The business can view this request in its authorized workspace.
              Sending it does not confirm acceptance.
            </p>
          </section>

          <aside
            className={styles.guideCard}
            aria-labelledby="next-steps-title"
          >
            <h2 id="next-steps-title">What happens next</h2>
            <ol className={styles.steps}>
              <li>
                <span>
                  <strong>Your request is saved</strong>
                  LocalHub records the listing and your request details.
                </span>
              </li>
              <li>
                <span>
                  <strong>The business responds</strong>
                  Its authorized workspace can accept or decline follow-up.
                </span>
              </li>
              <li>
                <span>
                  <strong>You decide what to do</strong>
                  Review the response before any separate order or booking.
                </span>
              </li>
            </ol>
            <p className={styles.boundary}>
              This request is for follow-up only. It is not an order, booking,
              payment, delivery promise, or availability guarantee.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
