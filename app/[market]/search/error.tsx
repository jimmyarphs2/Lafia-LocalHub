"use client";

import { CircleAlert, RotateCcw } from "lucide-react";

export default function SearchError({ reset }: { reset: () => void }) {
  return (
    <section className="container section">
      <div className="empty-state" role="alert">
        <CircleAlert aria-hidden="true" color="#d94a4a" size={32} />
        <h1>Search is temporarily unavailable.</h1>
        <p>Your query is still here. Retry when you are ready.</p>
        <button className="button button-primary" onClick={reset} type="button">
          <RotateCcw aria-hidden="true" size={18} /> Retry search
        </button>
      </div>
    </section>
  );
}
