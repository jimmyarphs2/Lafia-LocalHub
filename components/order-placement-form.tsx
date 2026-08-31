"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  placeListingOrder,
  type PlaceOrderActionResult,
} from "@/app/[market]/listings/[listing]/order/actions";

import styles from "./order-forms.module.css";

export function OrderPlacementForm({ intentId }: { intentId: string }) {
  const [state, formAction, pending] = useActionState<
    PlaceOrderActionResult | null,
    FormData
  >(placeListingOrder, null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state) feedbackRef.current?.focus();
  }, [state]);

  if (state && !state.retryable) {
    return (
      <p
        className={styles.feedback}
        ref={feedbackRef}
        role="alert"
        tabIndex={-1}
      >
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className={styles.form}>
      <input name="intent_id" type="hidden" value={intentId} />
      <button
        className="button button-primary"
        disabled={pending}
        type="submit"
      >
        {pending ? "Placing order…" : "Place order"}
      </button>
      <p className={styles.help}>
        This records the order for vendor confirmation. No payment is collected.
      </p>
      {pending ? (
        <p className={styles.feedback} role="status">
          Placing your order…
        </p>
      ) : null}
      {state ? (
        <p
          className={styles.feedback}
          ref={feedbackRef}
          role="alert"
          tabIndex={-1}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
