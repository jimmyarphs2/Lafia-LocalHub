import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  presentListingRequestStatus,
  requestIntentIdSchema,
} from "@/lib/requests/contract";
import { getCustomerListingRequest } from "@/lib/requests/rpc";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CustomerRequestDetailPage({
  params,
}: {
  params: Promise<{ market: string; request: string }>;
}) {
  const { market, request: requestId } = await params;
  if (!requestIntentIdSchema.safeParse(requestId).success) notFound();
  const client = await getServerSupabaseClient();
  const user =
    client && (await client.auth.getUser().catch(() => null))?.data.user;
  if (!client || !user)
    redirect(
      `/auth?next=${encodeURIComponent(`/${market}/requests/${requestId}`)}`,
    );
  const result = await getCustomerListingRequest(client, requestId).catch(
    () => ({
      request: null,
      error: true,
    }),
  );
  if (result.error) {
    return (
      <div className="container section" aria-labelledby="request-error-title">
        <p className="eyebrow">Request tracking</p>
        <h1 id="request-error-title">Request temporarily unavailable</h1>
        <p role="alert">
          We could not load this request. Please try again later.
        </p>
        <Link className="text-link" href={`/${market}/requests`}>
          Back to your requests
        </Link>
      </div>
    );
  }
  if (!result.request || result.request.marketSlug !== market) notFound();
  const presentation = presentListingRequestStatus(result.request.status);

  return (
    <div className="container section" aria-labelledby="request-tracking-title">
      <p className="breadcrumbs">
        <Link href={`/${market}/requests`}>Your requests</Link> /{" "}
        {result.request.requestNumber}
      </p>
      <section className="empty-state">
        <p className="eyebrow">Request tracking</p>
        <h1 id="request-tracking-title">
          Request {result.request.requestNumber}
        </h1>
        <p>
          <strong>{result.request.listingTitle ?? "Listing request"}</strong>
          {result.request.vendorName ? ` · ${result.request.vendorName}` : ""}
        </p>
        <p>
          <strong>{presentation.title}</strong>
        </p>
        <p>{presentation.description}</p>
        <p>
          Created{" "}
          {new Intl.DateTimeFormat("en-NG", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(result.request.createdAt))}
        </p>
        {result.request.details ? (
          <p>Your details: {result.request.details}</p>
        ) : (
          <p>You did not add optional details.</p>
        )}
        {result.request.vendorRespondedAt ? (
          <p>
            Vendor response recorded{" "}
            {new Intl.DateTimeFormat("en-NG", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(result.request.vendorRespondedAt))}
            .
          </p>
        ) : null}
        <p>
          This tracking record is for customer-vendor follow-up only. It does
          not create or confirm availability, a booking, order, or payment.
        </p>
      </section>
    </div>
  );
}
