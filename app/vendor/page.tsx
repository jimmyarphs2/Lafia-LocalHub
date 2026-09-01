import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentIdentity } from "@/lib/auth/identity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Vendor dashboard | LocalHub",
  description: "Open the LocalHub tools available to your business role.",
  robots: { index: false, follow: false },
};

const VENDOR_PATH = "/vendor";

function UnavailableState({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <section
      aria-labelledby="vendor-dashboard-unavailable-title"
      className="container section"
    >
      <p className="eyebrow">Vendor workspace</p>
      <h1 id="vendor-dashboard-unavailable-title">{title}</h1>
      <p role="alert">{description}</p>
    </section>
  );
}

function WorkspaceLink({
  description,
  href,
  label,
}: {
  description: string;
  href: string;
  label: string;
}) {
  return (
    <li>
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
        <Link className="button button-secondary" href={href}>
          Open {label.toLocaleLowerCase("en-NG")}
        </Link>
      </div>
    </li>
  );
}

export default async function VendorDashboardPage() {
  const identity = await getCurrentIdentity();
  if (!identity) {
    redirect(`/auth?next=${encodeURIComponent(VENDOR_PATH)}`);
  }

  if (identity.accessState !== "active") {
    return (
      <UnavailableState
        description={
          identity.suspended
            ? "Your account cannot open vendor tools right now. Contact LocalHub support if you believe this restriction is incorrect."
            : "LocalHub could not verify your profile state for this session. No vendor tools have been opened. Please try again later."
        }
        title="Vendor access is unavailable"
      />
    );
  }

  if (identity.role === "customer") {
    return (
      <section
        aria-labelledby="vendor-dashboard-start-title"
        className="container section"
      >
        <p className="eyebrow">Sell on LocalHub</p>
        <h1 id="vendor-dashboard-start-title">
          Start your business setup when you are ready.
        </h1>
        <p>
          {identity.displayName}, your customer account stays active while you
          add the business details LocalHub needs. You will not be classified as
          a vendor until you intentionally begin this setup.
        </p>
        <Link className="button button-primary" href="/vendor/onboarding">
          Start vendor setup
        </Link>
      </section>
    );
  }

  const business = identity.business;
  if (!business) {
    return (
      <UnavailableState
        description="LocalHub could not verify an accepted business membership for this session. No vendor tools have been opened."
        title="Vendor workspace is unavailable"
      />
    );
  }

  return (
    <section
      aria-labelledby="vendor-dashboard-title"
      className="container section"
    >
      <p className="eyebrow">Vendor dashboard</p>
      <h1 id="vendor-dashboard-title">{business.name}</h1>
      <p>
        {`Welcome back, ${identity.displayName}. Your accepted ${business.memberRole} access determines which business tools are available below.`}
      </p>
      <ul aria-label={`Tools for ${business.name}`} className="info-list">
        <WorkspaceLink
          description="Review and respond to customer enquiries for your listings."
          href="/vendor/requests"
          label="Requests"
        />
        <WorkspaceLink
          description="Review orders and continue their permitted fulfilment steps."
          href="/vendor/orders"
          label="Orders"
        />
        {business.canManageListings ? (
          <>
            <WorkspaceLink
              description="Create and continue unpublished product and service listings."
              href="/vendor/listings"
              label="Listings"
            />
            <WorkspaceLink
              description="Attach original media to listing drafts you manage."
              href="/vendor/media-lab"
              label="Media lab"
            />
          </>
        ) : null}
      </ul>
    </section>
  );
}
