"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { markNotificationRead, type NotificationActionResult } from "./actions";

function ActionFeedback({
  pending,
  state,
}: {
  pending: boolean;
  state: NotificationActionResult | null;
}) {
  const feedbackRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state) feedbackRef.current?.focus();
  }, [state]);

  if (pending) {
    return <p role="status">Marking as read…</p>;
  }
  if (!state) return null;
  return (
    <p ref={feedbackRef} role={state.ok ? "status" : "alert"} tabIndex={-1}>
      {state.message}
    </p>
  );
}

export function NotificationReadControl({
  market,
  notificationId,
  readAt,
}: {
  market: string;
  notificationId: string;
  readAt: string | null;
}) {
  const [state, formAction, pending] = useActionState<
    NotificationActionResult | null,
    FormData
  >(markNotificationRead, null);
  const [initiated, setInitiated] = useState(false);
  const completionRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (readAt !== null && initiated) {
      completionRef.current?.focus();
    }
  }, [initiated, readAt]);

  if (readAt !== null) {
    return (
      <p
        ref={completionRef}
        role={initiated ? "status" : undefined}
        tabIndex={initiated ? -1 : undefined}
      >
        Read
      </p>
    );
  }

  const terminal = Boolean(state && (state.ok || !state.retryable));

  return (
    <div>
      {!state || state.retryable ? <p>Unread</p> : null}
      {!terminal ? (
        <form
          action={formAction}
          onSubmit={() => {
            setInitiated(true);
          }}
        >
          <input name="market" type="hidden" value={market} />
          <input name="notification_id" type="hidden" value={notificationId} />
          <button
            className="button button-secondary"
            disabled={pending}
            type="submit"
          >
            {pending ? "Marking as read…" : "Mark as read"}
          </button>
        </form>
      ) : null}
      <ActionFeedback pending={pending} state={state} />
    </div>
  );
}
