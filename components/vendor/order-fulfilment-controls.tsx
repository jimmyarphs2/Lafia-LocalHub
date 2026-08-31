"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  startVendorOrderFulfilment,
  type VendorOrderFulfilmentActionResult,
} from "@/app/vendor/orders/fulfilment-actions";
import {
  presentOrderFulfilment,
  type ListingOrderRecord,
} from "@/lib/orders/contract";

export function OrderFulfilmentControls({
  orderId,
  initialIdempotencyKey,
  status,
  fulfilment,
}: {
  orderId: string;
  initialIdempotencyKey: string;
  status: ListingOrderRecord["status"];
  fulfilment: ListingOrderRecord["fulfilment"];
}) {
  const [state, formAction, pending] = useActionState<
    VendorOrderFulfilmentActionResult | null,
    FormData
  >(startVendorOrderFulfilment, null);
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const previousConfirming = useRef(confirming);
  const previousFulfilment = useRef(fulfilment);
  const previousState = useRef(state);

  useEffect(() => {
    const opened = !previousConfirming.current && confirming;
    const closed = previousConfirming.current && !confirming;
    if (opened) confirmationHeadingRef.current?.focus();
    else if (closed) triggerRef.current?.focus();
    previousConfirming.current = confirming;
  }, [confirming]);

  useEffect(() => {
    const fulfilmentAppeared =
      previousFulfilment.current === null && fulfilment !== null;
    const definitiveFeedbackAppeared =
      previousState.current !== state &&
      Boolean(state && (state.ok || !state.retryable));
    if (fulfilmentAppeared || definitiveFeedbackAppeared) {
      feedbackRef.current?.focus();
    }
    previousFulfilment.current = fulfilment;
    previousState.current = state;
  }, [fulfilment, state]);

  if (state?.ok) {
    return (
      <p ref={feedbackRef} role="status" tabIndex={-1}>
        {state.message}
      </p>
    );
  }

  if (state && !state.retryable) {
    return (
      <p ref={feedbackRef} role="alert" tabIndex={-1}>
        {state.message}
      </p>
    );
  }

  if (fulfilment) {
    const presentation = presentOrderFulfilment(fulfilment);
    return (
      <p ref={feedbackRef} role="status" tabIndex={-1}>
        {presentation.title}. {presentation.description}
      </p>
    );
  }

  if (status !== "confirmed") return null;

  return (
    <form action={formAction} className="form-stack">
      <input name="order_id" type="hidden" value={orderId} />
      <input
        name="idempotency_key"
        type="hidden"
        value={initialIdempotencyKey}
      />
      <div aria-label="Start fulfilment processing" role="group">
        <p className="help">
          This records that your business has begun handling the order. It does
          not collect payment, reserve stock, arrange pickup or delivery, or
          mark the order fulfilled.
        </p>
        {confirming ? (
          <section
            aria-describedby="start-processing-description"
            aria-labelledby="start-processing-title"
          >
            <h2
              id="start-processing-title"
              ref={confirmationHeadingRef}
              tabIndex={-1}
            >
              Start processing this order?
            </h2>
            <p id="start-processing-description">
              This records that your business has begun handling the order. It
              does not collect payment, reserve stock, arrange pickup or
              delivery, or mark the order fulfilled.
            </p>
            <div className="button-row">
              <button
                className="button button-secondary"
                disabled={pending}
                onClick={() => setConfirming(false)}
                type="button"
              >
                Not yet
              </button>
              <button
                className="button button-primary"
                disabled={pending}
                type="submit"
              >
                Yes, start processing
              </button>
            </div>
          </section>
        ) : (
          <button
            className="button button-primary"
            disabled={pending}
            onClick={() => setConfirming(true)}
            ref={triggerRef}
            type="button"
          >
            Start processing
          </button>
        )}
      </div>
      {pending ? <p role="status">Saving fulfilment processing…</p> : null}
      {state && !state.ok ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
