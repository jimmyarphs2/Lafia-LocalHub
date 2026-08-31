"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  respondToVendorRequest,
  type VendorRequestDecisionActionResult,
} from "@/app/vendor/requests/actions";
import {
  presentListingRequestStatus,
  type ListingRequestRecord,
} from "@/lib/requests/contract";

export function RequestDecisionControls({
  requestId,
  initialIdempotencyKey,
  status = "open",
}: {
  requestId: string;
  initialIdempotencyKey: string;
  status?: ListingRequestRecord["status"];
}) {
  const [state, formAction, pending] = useActionState<
    VendorRequestDecisionActionResult | null,
    FormData
  >(respondToVendorRequest, null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const previousStatus = useRef(status);
  const previousActionState = useRef(state);

  useEffect(() => {
    const terminalStatusAppeared =
      previousStatus.current === "open" && status !== "open";
    const definitiveActionFeedbackAppeared =
      previousActionState.current !== state &&
      Boolean(state && (state.ok || !state.retryable));

    if (terminalStatusAppeared || definitiveActionFeedbackAppeared) {
      feedbackRef.current?.focus();
    }

    previousStatus.current = status;
    previousActionState.current = state;
  }, [state, status]);

  if (state?.ok) {
    return (
      <p ref={feedbackRef} role="status" tabIndex={-1}>
        {state.message}
      </p>
    );
  }

  // A definitive outcome must not be submitted again with the same key. The
  // message directs the vendor to refresh, which supplies a new server key and
  // current authoritative request state.
  if (state && !state.retryable) {
    return (
      <p ref={feedbackRef} role="alert" tabIndex={-1}>
        {state.message}
      </p>
    );
  }

  if (status !== "open") {
    const presentation = presentListingRequestStatus(status);
    return (
      <p ref={feedbackRef} role="status" tabIndex={-1}>
        {presentation.title}. {presentation.description}
      </p>
    );
  }

  return (
    <form action={formAction} className="form-stack">
      <input name="request_id" type="hidden" value={requestId} />
      <input
        name="idempotency_key"
        type="hidden"
        value={initialIdempotencyKey}
      />
      <div aria-label="Respond to customer request" role="group">
        <p className="help">
          Choose whether to follow up with this customer. No booking, order, or
          payment is created.
        </p>
        <div className="button-row">
          <button
            className="button button-primary"
            disabled={pending}
            name="decision"
            type="submit"
            value="accept"
          >
            Accept request
          </button>
          <button
            className="button button-secondary"
            disabled={pending}
            name="decision"
            type="submit"
            value="decline"
          >
            Decline request
          </button>
        </div>
      </div>
      {pending ? <p role="status">Saving vendor response…</p> : null}
      {state && !state.ok ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
