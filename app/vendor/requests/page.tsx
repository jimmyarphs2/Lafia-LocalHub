import { redirect } from "next/navigation";

import { RequestDecisionControls } from "@/components/vendor/request-decision-controls";
import { presentListingRequestStatus } from "@/lib/requests/contract";
import { listVendorListingRequests } from "@/lib/requests/rpc";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function VendorRequestsPage() {
  const client = await getServerSupabaseClient();
  const user =
    client && (await client.auth.getUser().catch(() => null))?.data.user;
  if (!client || !user) redirect("/auth?next=%2Fvendor%2Frequests");
  const result = await listVendorListingRequests(client).catch(() => ({
    requests: [],
    error: true,
  }));
  return (
    <section
      className="container section"
      aria-labelledby="vendor-requests-title"
    >
      <p className="eyebrow">Vendor request inbox</p>
      <h1 id="vendor-requests-title">Customer requests for your listings</h1>
      <p>
        Respond to open requests for customer follow-up. A response does not
        create a booking, order, payment, or notification.
      </p>
      {result.error ? (
        <p role="alert">Requests are temporarily unavailable.</p>
      ) : null}
      {!result.error && result.requests.length === 0 ? (
        <p>No customer requests are available yet.</p>
      ) : null}
      <ul className="info-list" aria-label="Customer requests">
        {result.requests.map((request) => {
          const presentation = presentListingRequestStatus(request.status);
          return (
            <li key={request.id}>
              <div>
                <strong>{request.listingTitle ?? "Listing request"}</strong>
                <p>
                  Request {request.requestNumber} · {presentation.title}
                </p>
                <p className="help">{presentation.description}</p>
                {request.details ? (
                  <p>Customer details: {request.details}</p>
                ) : null}
                <RequestDecisionControls
                  initialIdempotencyKey={crypto.randomUUID()}
                  requestId={request.id}
                  status={request.status}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
