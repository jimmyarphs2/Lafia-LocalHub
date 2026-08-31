"use client";

import { useFormStatus } from "react-dom";

export function RequestSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button button-primary" disabled={pending} type="submit">
      {pending ? "Creating request…" : "Create request"}
    </button>
  );
}
