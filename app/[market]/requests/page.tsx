import Link from "next/link";
import { redirect } from "next/navigation";

import { presentListingRequestStatus } from "@/lib/requests/contract";
import { listCustomerListingRequests } from "@/lib/requests/rpc";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CustomerRequestsPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market } = await params;
  const client = await getServerSupabaseClient();
  const user =
    client && (await client.auth.getUser().catch(() => null))?.data.user;
  if (!client || !user)
    redirect(`/auth?next=${encodeURIComponent(`/${market}/requests`)}`);
  const result = await listCustomerListingRequests(client, market).catch(
    () => ({
      requests: [],
      error: true,
    }),
  );

  return (
    <div
      className="container section"
      aria-labelledby="customer-requests-title"
    >
      <p className="eyebrow">Customer requests</p>
      <h1 id="customer-requests-title">Your requests</h1>
      <p>
        Track vendor responses to your requests. A response is for follow-up
        only and does not create a booking, payment, or order.
      </p>
      {result.error ? (
        <p role="alert">
          Your requests are temporarily unavailable. Please try again later.
        </p>
      ) : null}
      {!result.error && result.requests.length === 0 ? (
        <p>You have not created any requests in this market yet.</p>
      ) : null}
      <ul className="info-list" aria-label="Your request history">
        {result.requests.map((request) => {
          const presentation = presentListingRequestStatus(request.status);
          return (
            <li key={request.id}>
              <span>
                <strong>{request.listingTitle ?? "Listing request"}</strong>
                <br />
                Request {request.requestNumber} · {presentation.title}
                <br />
                <span className="help">{presentation.description}</span>
              </span>
              <Link
                className="text-link"
                href={`/${market}/requests/${request.id}`}
              >
                View request
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
