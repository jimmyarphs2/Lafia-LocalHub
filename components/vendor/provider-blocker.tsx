import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";

import styles from "@/components/vendor/vendor-onboarding.module.css";

type BlockerKind =
  | "provider_not_configured"
  | "authentication_unavailable"
  | "database_unavailable";

const blockerCopy: Record<
  BlockerKind,
  { eyebrow: string; heading: string; body: string; items: readonly string[] }
> = {
  provider_not_configured: {
    eyebrow: "External setup required",
    heading: "Vendor onboarding needs a secure data connection.",
    body: "This environment does not have the public Supabase connection settings required for authentication and protected draft storage. No onboarding data has been accepted or stored.",
    items: [
      "Configure the public Supabase URL and anonymous key in the local environment.",
      "Apply the reviewed LocalHub database migration and Row Level Security policies.",
      "Restart the development server, then sign in before returning here.",
    ],
  },
  authentication_unavailable: {
    eyebrow: "Authentication temporarily unavailable",
    heading: "We could not verify your session safely.",
    body: "Vendor onboarding remains locked because LocalHub could not confirm who is making this request. No draft changes were written.",
    items: [
      "Check the configured authentication provider and network connection.",
      "Try signing in again when the provider is available.",
    ],
  },
  database_unavailable: {
    eyebrow: "Secure storage not ready",
    heading: "Your vendor draft store is not available yet.",
    body: "LocalHub verified your session, but the protected onboarding tables or RPCs are not ready in this environment. We have not fallen back to browser-only or unprotected storage.",
    items: [
      "Apply and verify the LocalHub Supabase migration.",
      "Confirm the onboarding RPCs and Row Level Security policies are active.",
      "Return here after the database setup passes its security checks.",
    ],
  },
};

export function VendorProviderBlocker({ kind }: { kind: BlockerKind }) {
  const copy = blockerCopy[kind];
  return (
    <section className={styles.blocker} aria-labelledby="vendor-blocker-title">
      <LockKeyhole aria-hidden="true" color="#2350f4" size={30} />
      <p className={styles.eyebrow}>{copy.eyebrow}</p>
      <h1 id="vendor-blocker-title">{copy.heading}</h1>
      <p>{copy.body}</p>
      <ul className={styles.blockerList}>
        {copy.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <Link className={styles.buttonLink} href="/lafia">
        <ArrowLeft aria-hidden="true" size={18} /> Back to the Lafia demo
      </Link>
    </section>
  );
}
