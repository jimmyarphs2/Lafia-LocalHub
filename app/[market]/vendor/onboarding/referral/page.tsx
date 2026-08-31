import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { marketSlugSchema } from "@/lib/requests/contract";

export const metadata: Metadata = {
  title: "Vendor onboarding information | LocalHub",
  robots: { index: false, follow: false },
};

export default async function ReferralDisclosurePage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const market = marketSlugSchema.safeParse((await params).market);
  if (!market.success) notFound();

  return (
    <section
      className="container section"
      aria-labelledby="referral-disclosure-title"
    >
      <p className="eyebrow">Vendor onboarding information</p>
      <h1 id="referral-disclosure-title">Continue without referral tracking</h1>
      <p>
        LocalHub is not tracking this visit or assigning it to another person.
        Referral credit, rewards and commissions are not active.
      </p>
      <p>
        Continuing uses the normal vendor onboarding experience. It does not
        promise a reward, payment, ranking advantage, or special approval.
      </p>
      <Link className="button button-primary" href="/vendor/onboarding">
        Continue to vendor onboarding
      </Link>
    </section>
  );
}
