import Link from "next/link";

import type { PendingBusinessTriageItem } from "@/lib/admin/business-triage-contract";

import styles from "./business-triage.module.css";

const categoryLabels: Record<
  PendingBusinessTriageItem["categorySlug"],
  string
> = {
  "food-catering": "Food and catering",
  "electronics-repair": "Electronics repair",
  "photography-media": "Photography and media",
  "fashion-tailoring": "Fashion and tailoring",
  "beauty-personal-care": "Beauty and personal care",
  "home-building-services": "Home and building services",
  "events-venues": "Events and venues",
  "transport-logistics": "Transport and logistics",
  "education-training": "Education and training",
  "other-local-trade": "Other local trade",
};

const nigeriaDateTime = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Lagos",
});

export function BusinessTriageQueue({
  businesses,
  nextHref,
}: {
  businesses: PendingBusinessTriageItem[];
  nextHref: string | null;
}) {
  return (
    <section
      aria-labelledby="business-triage-queue-title"
      className={styles.card}
    >
      <div className={styles.cardHeading}>
        <div>
          <p className={styles.eyebrow}>Read-only merchant review triage</p>
          <h2 id="business-triage-queue-title">Pending business submissions</h2>
        </div>
        <span className={styles.readOnlyBadge}>No decisions enabled</span>
      </div>

      {businesses.length === 0 ? (
        <p className={styles.empty} role="status">
          No pending merchant submissions were returned for this market.
        </p>
      ) : (
        <div
          aria-label="Pending business submissions table"
          className={styles.tableViewport}
          role="region"
          tabIndex={0}
        >
          <table className={styles.table}>
            <caption className="sr-only">
              Oldest pending business submissions in the selected market
            </caption>
            <thead>
              <tr>
                <th scope="col">Business</th>
                <th scope="col">Category</th>
                <th scope="col">Submitted</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {businesses.map((business) => (
                <tr key={business.businessId}>
                  <th scope="row">
                    <strong>{business.businessName}</strong>
                    <small>{business.marketName}</small>
                  </th>
                  <td>{categoryLabels[business.categorySlug]}</td>
                  <td>
                    <time dateTime={business.submittedAt}>
                      {nigeriaDateTime.format(new Date(business.submittedAt))}
                    </time>
                  </td>
                  <td>
                    <span className={styles.pendingStatus}>
                      Awaiting review
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextHref ? (
        <nav
          aria-label="Business triage pagination"
          className={styles.pagination}
        >
          <Link href={nextHref}>View the next pending submissions</Link>
        </nav>
      ) : null}
    </section>
  );
}
