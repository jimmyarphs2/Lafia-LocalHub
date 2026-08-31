"use client";

import { useFormStatus } from "react-dom";

export function DemandSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button button-primary" disabled={pending} type="submit">
      {pending ? "Recording category gap…" : "Record category gap"}
    </button>
  );
}
