import { Building2, ClipboardList, ShoppingBag, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentIdentity } from "@/lib/auth/identity";
import { marketSlugSchema } from "@/lib/requests/contract";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your account | LocalHub",
  robots: { index: false, follow: false },
};

export default async function AccountPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const market = marketSlugSchema.safeParse((await params).market);
  if (!market.success) notFound();

  const identity = await getCurrentIdentity();
  if (!identity) {
    const next = `/${market.data}/account`;
    redirect(`/auth?next=${encodeURIComponent(next)}`);
  }

  return (
    <section
      className="container section account-page"
      aria-labelledby="account-title"
    >
      <p className="eyebrow">Your LocalHub account</p>
      <h1 id="account-title">Welcome, {identity.displayName}</h1>
      <p>
        Your verified sign-in keeps requests, orders, and business workspaces
        connected without asking you to enter the same details again.
      </p>

      {identity.accessState === "unavailable" ? (
        <p className="account-status" role="status">
          Your sign-in is active. Private account details are temporarily
          unavailable, and LocalHub has kept marketplace actions closed.
        </p>
      ) : null}
      {identity.suspended ? (
        <p className="account-error" role="alert">
          This profile is currently restricted. Private marketplace actions are
          unavailable, but you can still sign out safely.
        </p>
      ) : null}

      <div className="account-grid">
        <article className="account-card">
          <UserRound aria-hidden="true" size={22} />
          <h2>Profile</h2>
          <p>
            <strong>{identity.displayName}</strong>
            {identity.email ? (
              <>
                <br />
                <span>{identity.email}</span>
              </>
            ) : null}
          </p>
          <p>Signed in securely through your verified identity provider.</p>
        </article>

        {identity.accessState === "active" ? (
          <>
            <article className="account-card">
              <ClipboardList aria-hidden="true" size={22} />
              <h2>Activity</h2>
              <p>
                See LocalHub notifications and continue recent marketplace work.
              </p>
              <Link className="text-link" href={`/${market.data}/activity`}>
                Open activity
              </Link>
            </article>

            <article className="account-card">
              <ShoppingBag aria-hidden="true" size={22} />
              <h2>Orders and requests</h2>
              <p>
                <Link className="text-link" href={`/${market.data}/orders`}>
                  View orders
                </Link>
                <br />
                <Link className="text-link" href={`/${market.data}/requests`}>
                  View requests
                </Link>
              </p>
            </article>

            {identity.business ? (
              <article className="account-card">
                <Building2 aria-hidden="true" size={22} />
                <h2>{identity.business.name}</h2>
                <p>Your accepted business workspace is ready.</p>
                <Link className="text-link" href="/vendor">
                  Open vendor dashboard
                </Link>
              </article>
            ) : (
              <article className="account-card">
                <Building2 aria-hidden="true" size={22} />
                <h2>Sell on LocalHub</h2>
                <p>
                  Start vendor onboarding only when you are ready to list a
                  business.
                </p>
                <Link className="text-link" href="/vendor/onboarding">
                  Begin vendor onboarding
                </Link>
              </article>
            )}
          </>
        ) : null}
      </div>
      <form action="/auth/logout" className="account-signout" method="post">
        <input name="next" type="hidden" value={`/${market.data}`} />
        <button className="button button-secondary" type="submit">
          Sign out of LocalHub
        </button>
      </form>
    </section>
  );
}
