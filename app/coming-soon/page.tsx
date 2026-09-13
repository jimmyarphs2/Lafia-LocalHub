import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock3 } from "lucide-react";
import { LaunchCountdown } from "@/components/launch-countdown";

export const metadata: Metadata = {
  title: "LocalHub early access",
  description: "Follow the LocalHub early-access launch plan.",
};

export default async function ComingSoonPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { role } = await searchParams;
  const audience = role === "seller" ? "seller" : "buyer";
  return (
    <main className="section container" style={{ minHeight: "100svh", paddingTop: 72, maxWidth: 760 }}>
      <Link className="text-link" href="/">← Back to LocalHub</Link>
      <p className="eyebrow" style={{ marginTop: 38 }}>Early access · {audience}</p>
      <h1 style={{ fontSize: "clamp(2.5rem, 7vw, 5rem)", lineHeight: 1.05, letterSpacing: "-.06em" }}>A stronger local marketplace is on the way.</h1>
      <p style={{ color: "var(--muted)", fontSize: "1.12rem", maxWidth: 620 }}>Browse, learn, and prepare now. The planned launch target is shown for coordination—not as a promise that every marketplace feature is live today.</p>
      <div className="notice" style={{ margin: "28px 0", padding: 22 }}>
        <Clock3 size={20} aria-hidden="true" />
        <p style={{ margin: "8px 0 0" }}><strong>Planned launch target: 12 April 2027</strong></p>
        <p style={{ margin: "5px 0 0", color: "var(--muted)" }}><LaunchCountdown /></p>
      </div>
      <nav style={{ display: "flex", flexWrap: "wrap", gap: 14 }} aria-label="Early access next steps">
        <Link className="button button-primary" href="/resources">Read the guides <ArrowRight size={16} /></Link>
        <Link className="button" href="/vendor/onboarding">Prepare to sell <ArrowRight size={16} /></Link>
        <Link className="text-link" href="/auth?next=%2Fcoming-soon">Create an account <ArrowRight size={16} /></Link>
      </nav>
    </main>
  );
}
