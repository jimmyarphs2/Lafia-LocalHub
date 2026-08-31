"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  respondToVendorOrder,
  type VendorOrderDecisionActionResult,
} from "@/app/vendor/orders/actions";
import {
  presentOrderStatus,
  type ListingOrderRecord,
} from "@/lib/orders/contract";

export function OrderDecisionControls({
  orderId,
  initialIdempotencyKey,
  status = "placed",
}: {
  orderId: string;
  initialIdempotencyKey: string;
  status?: ListingOrderRecord["status"];
}) {
  const [state, formAction, pending] = useActionState<
    VendorOrderDecisionActionResult | null,
    FormData
  >(respondToVendorOrder, null);
  const [confirmingCancellation, setConfirmingCancellation] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const cancellationConfirmationRef = useRef<HTMLHeadingElement>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const previousCancellationConfirmation = useRef(confirmingCancellation);
  const previousStatus = useRef(status);
  const previousActionState = useRef(state);

  useEffect(() => {
    const confirmationOpened =
      !previousCancellationConfirmation.current && confirmingCancellation;
    const confirmationClosed =
      previousCancellationConfirmation.current && !confirmingCancellation;

    if (confirmationOpened) {
      cancellationConfirmationRef.current?.focus();
    } else if (confirmationClosed) {
      cancelButtonRef.current?.focus();
    }

    previousCancellationConfirmation.current = confirmingCancellation;
  }, [confirmingCancellation]);

  useEffect(() => {
    const terminalStatusAppeared =
      previousStatus.current === "placed" && status !== "placed";
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
  // detail page refresh supplies a new server key and current order state.
  if (state && !state.retryable) {
    return (
      <p ref={feedbackRef} role="alert" tabIndex={-1}>
        {state.message}
      </p>
    );
  }

  if (status !== "placed") {
    const presentation = presentOrderStatus(status);
    return (
      <p ref={feedbackRef} role="status" tabIndex={-1}>
        {presentation.title}. {presentation.description}
      </p>
    );
  }

  return (
    <form action={formAction} className="form-stack">
      <input name="order_id" type="hidden" value={orderId} />
      <input
        name="idempotency_key"
        type="hidden"
        value={initialIdempotencyKey}
      />
      <div aria-label="Decide vendor availability" role="group">
        <p className="help">
          Confirming records vendor availability only. It does not collect
          payment or start fulfilment. Cancelling happens before payment, so no
          refund is created.
        </p>
        {confirmingCancellation ? (
          <section
            aria-describedby="cancel-order-description"
            aria-labelledby="cancel-order-title"
          >
            <h2
              id="cancel-order-title"
              ref={cancellationConfirmationRef}
              tabIndex={-1}
            >
              Cancel this order?
            </h2>
            <p id="cancel-order-description">
              This permanently records a vendor cancellation. It cannot be
              undone. No payment has been collected, so no refund is created.
            </p>
            <div className="button-row">
              <button
                className="button button-secondary"
                disabled={pending}
                onClick={() => setConfirmingCancellation(false)}
                type="button"
              >
                Keep order
              </button>
              <button
                className="button button-primary"
                disabled={pending}
                name="decision"
                type="submit"
                value="cancel"
              >
                Yes, cancel order
              </button>
            </div>
          </section>
        ) : (
          <div className="button-row">
            <button
              className="button button-primary"
              disabled={pending}
              name="decision"
              type="submit"
              value="confirm"
            >
              Confirm order
            </button>
            <button
              className="button button-secondary"
              disabled={pending}
              onClick={() => setConfirmingCancellation(true)}
              ref={cancelButtonRef}
              type="button"
            >
              Cancel order
            </button>
          </div>
        )}
      </div>
      {pending ? <p role="status">Saving vendor decision…</p> : null}
      {state && !state.ok ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
