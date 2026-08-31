"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  createMerchantReferralLink,
  setMerchantReferralLinkEnabled,
  type ReferralOwnerActionResult,
} from "./actions";
import styles from "./referral-owner.module.css";

function ActionFeedback({
  pending,
  pendingMessage,
  state,
}: {
  pending: boolean;
  pendingMessage: string;
  state: ReferralOwnerActionResult | null;
}) {
  const feedbackRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state) feedbackRef.current?.focus();
  }, [state]);

  if (pending)
    return (
      <p className={styles.feedback} role="status">
        {pendingMessage}
      </p>
    );
  if (!state) return null;
  return (
    <p
      ref={feedbackRef}
      role={state.ok ? "status" : "alert"}
      className={styles.feedback}
      tabIndex={-1}
    >
      {state.message}
    </p>
  );
}

export function ReferralCreateForm({ market }: { market: string }) {
  const [state, formAction, pending] = useActionState<
    ReferralOwnerActionResult | null,
    FormData
  >(createMerchantReferralLink, null);

  return (
    <form action={formAction} className={styles.stack}>
      <input name="market" type="hidden" value={market} />
      <button
        className={`button button-primary ${styles.actionButton}`}
        disabled={pending}
        type="submit"
      >
        {pending ? "Creating referral link…" : "Create merchant referral link"}
      </button>
      <ActionFeedback
        pending={pending}
        pendingMessage="Creating your referral link…"
        state={state}
      />
    </form>
  );
}

export function ReferralToggleForm({
  linkId,
  market,
  status,
}: {
  linkId: string;
  market: string;
  status: "active" | "disabled";
}) {
  const [state, formAction, pending] = useActionState<
    ReferralOwnerActionResult | null,
    FormData
  >(setMerchantReferralLinkEnabled, null);
  const enabling = status === "disabled";

  return (
    <form action={formAction} className={styles.stack}>
      <input name="market" type="hidden" value={market} />
      <input name="link_id" type="hidden" value={linkId} />
      <input name="enabled" type="hidden" value={String(enabling)} />
      <button
        className={`button button-secondary ${styles.actionButton}`}
        disabled={pending}
        type="submit"
      >
        {pending
          ? enabling
            ? "Enabling referral link…"
            : "Disabling referral link…"
          : enabling
            ? "Enable referral link"
            : "Disable referral link"}
      </button>
      <ActionFeedback
        pending={pending}
        pendingMessage={
          enabling
            ? "Enabling your referral link…"
            : "Disabling your referral link…"
        }
        state={state}
      />
    </form>
  );
}
