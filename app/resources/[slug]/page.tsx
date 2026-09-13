import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { notFound } from "next/navigation";
import styles from "../resources.module.css";

const guides = {
  "how-localhub-works": {
    title: "How local discovery works",
    intro: "LocalHub is designed for a clear request, a nearby published option, and a next step you can verify.",
    image: "/images/localhub-demo-market-hero.webp",
    sections: [
      ["Start with a natural request", "Say what you need in your own words. Add a budget in naira, timing, and area when they matter."],
      ["Compare the evidence", "Results come from published listing details and deterministic matching. Budget and timing help rank options; they are not guarantees."],
      ["Take the next step", "Open a listing to confirm current price and availability with the business. If nothing matches, invite a business or prepare a request for launch."],
    ],
  },
  "prepare-your-shop": {
    title: "Prepare your shop",
    intro: "The strongest early listings answer the questions a buyer has before they message you.",
    image: "/images/localhub-demo-photographer.webp",
    sections: [
      ["Make the basics clear", "Use a recognisable business name, service category, area, hours, and a contact method you can answer."],
      ["Show useful evidence", "Add clear photos, starting prices or price ranges, delivery boundaries, and the date each detail was last checked."],
      ["Plan fulfilment", "Decide who owns a missed call, delayed order, refund question, or unavailable item before inviting customers."],
    ],
  },
  "early-access-updates": {
    title: "Early-access updates",
    intro: "LocalHub is being tested in small, transparent steps while the public launch remains in preparation.",
    image: "/images/localhub-demo-cake-pink.webp",
    sections: [
      ["What is open now", "You can browse published demo or live directory records, try budget-aware search, and read the buyer and seller guides."],
      ["What stays coming soon", "Public waitlist operations, marketplace requests, payments, and broad vendor activation require a separate launch gate."],
      ["How to follow along", "Create an account when sign-in is available, read the launch plan, and return to the entry screen as the directory grows."],
    ],
  },
} as const;

type Slug = keyof typeof guides;

export function generateStaticParams() {
  return Object.keys(guides).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const guide = guides[slug as Slug];
  return guide ? { title: guide.title, description: guide.intro } : {};
}

export default async function ResourceGuide({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = guides[slug as Slug];
  if (!guide) notFound();
  return (
    <main className={styles.page}>
      <article className={`container ${styles.article}`}>
        <Link className={styles.back} href="/resources">← All resources</Link>
        <p className={styles.eyebrow}>LocalHub guide</p>
        <h1>{guide.title}</h1>
        <p>{guide.intro}</p>
        <figure>
          <Image src={guide.image} alt="" width={1200} height={600} priority sizes="(max-width: 780px) 100vw, 780px" />
        </figure>
        {guide.sections.map(([heading, body]) => (
          <section key={heading}>
            <h2>{heading}</h2>
            <p>{body}</p>
          </section>
        ))}
        <nav className={styles.next} aria-label="Next steps">
          <Link href="/">Try LocalHub search <ArrowRight size={16} /></Link>
          <Link href="/vendor/onboarding">Start preparing to sell <ArrowRight size={16} /></Link>
          <Link href="/coming-soon">View launch plan <ArrowRight size={16} /></Link>
        </nav>
      </article>
    </main>
  );
}
