"use client";

import { Bookmark, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

import styles from "./listing-profile-experience.module.css";

export function ListingDocumentTitle({
  market,
  title,
}: {
  market: string;
  title: string;
}) {
  useEffect(() => {
    document.title = title + " in " + market;
  }, [market, title]);

  return null;
}

export function ListingProfileActions({ title }: { title: string }) {
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState("");

  const share = async () => {
    setStatus("");
    try {
      if (navigator.share) {
        await navigator.share({ title, url: window.location.href });
        setStatus("Share options opened.");
        return;
      }
      await navigator.clipboard.writeText(window.location.href);
      setStatus("Listing link copied.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("The listing link could not be shared.");
    }
  };

  return (
    <div className={styles.utilityActions}>
      <button
        aria-label={saved ? "Remove saved listing" : "Save listing"}
        aria-pressed={saved}
        onClick={() => {
          setSaved((current) => !current);
          setStatus(
            saved
              ? "Listing removed from saved."
              : "Listing saved on this device.",
          );
        }}
        type="button"
      >
        <Bookmark
          aria-hidden="true"
          fill={saved ? "currentColor" : "none"}
          size={21}
        />
      </button>
      <button aria-label="Share listing" onClick={share} type="button">
        <Share2 aria-hidden="true" size={21} />
      </button>
      <span aria-live="polite" className="sr-only" role="status">
        {status}
      </span>
    </div>
  );
}
