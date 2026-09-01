/* eslint-disable @next/next/no-img-element -- provider avatars are small, dynamic, and host-validated server-side */
import { Building2, ChevronDown, LogOut, UserRound } from "lucide-react";
import Link from "next/link";

import type { AuthIdentity } from "@/lib/auth/identity";

export function AccountMenu({
  identity,
  marketSlug,
}: {
  identity: AuthIdentity | null;
  marketSlug: string;
}) {
  const accountPath = `/${marketSlug}/account`;
  if (!identity) {
    return (
      <Link
        aria-label="Sign in"
        className="identity-sign-in"
        href={`/auth?next=${encodeURIComponent(accountPath)}`}
      >
        <UserRound aria-hidden="true" size={17} /> <span>Sign in</span>
      </Link>
    );
  }

  const activeVendor =
    identity.accessState === "active" &&
    identity.role === "vendor" &&
    identity.business !== null;
  const label = activeVendor ? identity.business!.name : identity.displayName;
  const initial = label.slice(0, 1).toLocaleUpperCase("en-NG");
  const identityStateLabel =
    identity.accessState === "suspended"
      ? "Restricted account"
      : identity.accessState === "unavailable"
        ? "Account unavailable"
        : activeVendor
          ? "Vendor"
          : "Customer";

  return (
    <details className="account-menu">
      <summary aria-label={`Open account menu for ${label}`}>
        {identity.avatarUrl ? (
          <img alt="" height="30" src={identity.avatarUrl} width="30" />
        ) : (
          <span aria-hidden="true" className="identity-initial">
            {initial}
          </span>
        )}
        <span className="identity-copy">
          <strong>{label}</strong>
          <small>{identityStateLabel}</small>
        </span>
        <ChevronDown aria-hidden="true" size={16} />
      </summary>
      <nav aria-label="Account navigation" className="account-menu-panel">
        {activeVendor ? (
          <>
            <Link href="/vendor">
              <Building2 aria-hidden="true" size={17} /> Vendor dashboard
            </Link>
            <Link href="/vendor/requests">Requests</Link>
            <Link href="/vendor/orders">Orders</Link>
            {identity.business?.canManageListings ? (
              <Link href="/vendor/listings">Products &amp; listings</Link>
            ) : null}
            <Link href={accountPath}>Business &amp; account</Link>
          </>
        ) : (
          <>
            <Link href={accountPath}>Account &amp; profile</Link>
            {identity.accessState === "active" ? (
              <>
                <Link href={`/${marketSlug}/activity`}>Activity</Link>
                <Link href={`/${marketSlug}/orders`}>Orders</Link>
                <Link href={`/${marketSlug}/requests`}>Requests</Link>
              </>
            ) : null}
          </>
        )}
        <form action="/auth/logout" method="post">
          <input name="next" type="hidden" value={`/${marketSlug}`} />
          <button type="submit">
            <LogOut aria-hidden="true" size={17} /> Sign out
          </button>
        </form>
      </nav>
    </details>
  );
}
