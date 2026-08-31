import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { referralIdSchema } from "@/lib/referrals/contract";
import { listMyReferralLinks } from "@/lib/referrals/rpc";
import { marketSlugSchema } from "@/lib/requests/contract";
import { getServerSupabaseClient } from "@/lib/supabase/server";

import {
  ReferralCreateForm,
  ReferralToggleForm,
} from "./referral-link-controls";
import styles from "./referral-owner.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Merchant referral link | LocalHub",
  robots: { index: false, follow: false },
};

export default async function ReferralOwnerPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const route = marketSlugSchema.safeParse((await params).market);
  if (!route.success) notFound();

  const client = await getServerSupabaseClient().catch(() => null);
  const user =
    client && (await client.auth.getUser().catch(() => null))?.data.user;
  if (!client || !user) {
    redirect(
      `/auth?next=${encodeURIComponent(`/${route.data}/refer/merchant`)}`,
    );
  }

  const access = await Promise.all([
    client.rpc("is_current_profile_active"),
    client
      .from("markets")
      .select("id,slug")
      .eq("slug", route.data)
      .eq("is_active", true)
      .maybeSingle(),
  ]).catch(() => null);
  if (!access) notFound();

  const [profileResult, marketResult] = access;
  const marketId = referralIdSchema.safeParse(marketResult.data?.id);
  if (
    profileResult.error ||
    profileResult.data !== true ||
    marketResult.error ||
    !marketId.success ||
    marketResult.data?.slug !== route.data
  ) {
    notFound();
  }

  // GET remains read-only: identity and link creation are POST-only actions.
  const result = await listMyReferralLinks(client).catch(() => ({
    links: [],
    error: true,
  }));
  const marketLinks = result.error
    ? []
    : result.links.filter((link) => link.marketId === marketId.data);
  const unavailable = Boolean(result.error) || marketLinks.length > 1;
  const link = unavailable ? null : (marketLinks[0] ?? null);

  return (
    <section
      className={`container section ${styles.page}`}
      aria-labelledby="merchant-referral-title"
    >
      <div className={styles.intro}>
        <p className="eyebrow">Merchant introductions</p>
        <h1 id="merchant-referral-title">Your merchant referral link</h1>
        <p>
          Create one private owner link for this market. The link currently
          opens a disclosure page and standard vendor onboarding only.
        </p>
        <p className={styles.notice}>
          Tracking, attribution, referral credit, rewards, commissions, and
          payouts are not active.
        </p>
      </div>

      {unavailable ? (
        <p className={styles.feedback} role="alert" tabIndex={-1}>
          Referral links are temporarily unavailable. Please try again later.
        </p>
      ) : null}

      {!unavailable && !link ? (
        <div className={`${styles.card} ${styles.stack}`}>
          <h2>No merchant referral link yet</h2>
          <p>Create the single link available for this market.</p>
          <ReferralCreateForm market={route.data} />
        </div>
      ) : null}

      {!unavailable && link ? (
        <div className={`${styles.card} ${styles.stack}`}>
          <h2>Merchant onboarding link</h2>
          <p>
            Status: <strong>{link.status}</strong>
          </p>
          <p className={styles.pathRow}>
            <span>Share path:</span>{" "}
            <code className={styles.code}>{`/r/${link.code}`}</code>
          </p>
          <Link className="text-link" href={`/r/${link.code}`} rel="nofollow">
            Open referral disclosure
          </Link>
          {link.expiresAt ? (
            <p className={styles.help}>
              Expiry recorded:{" "}
              <time dateTime={link.expiresAt}>
                {new Intl.DateTimeFormat("en-NG", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Africa/Lagos",
                }).format(new Date(link.expiresAt))}
              </time>
            </p>
          ) : null}
          {link.status === "active" || link.status === "disabled" ? (
            <ReferralToggleForm
              linkId={link.linkId}
              market={route.data}
              status={link.status}
            />
          ) : (
            <p role="status">
              This referral link has expired and cannot be enabled here.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
