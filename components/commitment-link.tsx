import { ArrowRight } from "lucide-react";

const maxSearchContextLength = 160;

export function normalizeSearchContext(value: string | undefined): string {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxSearchContextLength);
}

export function listingReturnTo(
  market: string,
  listing: string,
  query?: string,
): string {
  const context = normalizeSearchContext(query);
  const params = new URLSearchParams();
  if (context) params.set("q", context);
  const suffix = params.size ? `?${params.toString()}` : "";
  return `/${market}/listings/${listing}${suffix}`;
}

export function createListingIntentPayload({
  market,
  listing,
  listingId,
  action,
  query,
}: {
  market: string;
  listing: string;
  listingId?: string;
  action: "enquire" | "request-booking";
  query?: string;
}): string {
  const payload: Record<string, string> = {
    type: "listing_commitment",
    market,
    listing,
    requested_action: action,
  };
  if (listingId) payload.listing_id = listingId;
  const context = normalizeSearchContext(query);
  if (context) payload.search_query = context;
  return JSON.stringify(payload);
}

export function GuestIntentForm({
  label,
  returnTo,
  payload,
}: {
  label: string;
  returnTo: string;
  payload: string;
}) {
  return (
    <form action="/auth/intent" method="post">
      <input name="action" type="hidden" value="continue" />
      <input name="return_to" type="hidden" value={returnTo} />
      <input name="payload" type="hidden" value={payload} />
      <button className="button button-primary" type="submit">
        {label} <ArrowRight aria-hidden="true" size={17} />
      </button>
    </form>
  );
}

export function DemoCommitmentNotice() {
  return (
    <div className="empty-state" role="status">
      <h3>Requests are unavailable for demo listings.</h3>
      <p>Demo entries are for browsing only and never send a vendor request.</p>
    </div>
  );
}

export function CommitmentLink({
  action,
  label: labelOverride,
  market,
  listing,
  query,
}: {
  action: "enquire" | "request-booking";
  label?: string;
  market: string;
  listing: string;
  query?: string;
}) {
  const label =
    labelOverride ??
    (action === "request-booking" ? "Request a booking" : "Send an enquiry");
  return (
    <form
      action={`/${market}/listings/${listing}/request/intent`}
      method="post"
    >
      <input name="requested_action" type="hidden" value={action} />
      <input
        name="search_context"
        type="hidden"
        value={normalizeSearchContext(query)}
      />
      <button className="button button-primary" type="submit">
        {label} <ArrowRight aria-hidden="true" size={17} />
      </button>
    </form>
  );
}
