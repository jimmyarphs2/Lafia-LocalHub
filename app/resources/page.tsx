import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, Rocket, Store } from "lucide-react";
import styles from "./resources.module.css";

export const metadata: Metadata = {
  title: "LocalHub resources",
  description:
    "Practical guides for buyers and local businesses preparing for LocalHub.",
};

const cards = [
  {
    slug: "how-localhub-works",
    title: "How local discovery works",
    body: "Describe what you need, add a budget, and compare published nearby options.",
    icon: BookOpen,
    image: styles.shop,
  },
  {
    slug: "prepare-your-shop",
    title: "Prepare your shop",
    body: "A simple checklist for photos, hours, prices, and fulfilment details.",
    icon: Store,
    image: styles.seller,
  },
  {
    slug: "early-access-updates",
    title: "Early-access updates",
    body: "See what is being tested now and how to join the launch waitlist.",
    icon: Rocket,
    image: styles.cake,
  },
];

export default function ResourcesPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className="container">
          <Link className={styles.back} href="/">
            ← Back to LocalHub
          </Link>
          <p className={styles.eyebrow}>Learn before launch</p>
          <h1>Make your next local request easier.</h1>
          <p>
            Short, honest guides for discovering nearby businesses and getting
            your shop ready for LocalHub.
          </p>
        </div>
      </section>
      <section
        className={`container ${styles.grid}`}
        aria-label="LocalHub guides"
      >
        {cards.map(({ slug, title, body, icon: Icon, image }) => (
          <article className={styles.card} key={slug}>
            <div
              className={`${styles.cardImage} ${image}`}
              aria-hidden="true"
            />
            <div className={styles.cardBody}>
              <Icon size={20} aria-hidden="true" />
              <h2>{title}</h2>
              <p>{body}</p>
              <Link className={styles.link} href={`/resources/${slug}`}>
                Read guide <ArrowRight size={16} />
              </Link>
            </div>
          </article>
        ))}
      </section>
      <section className="container" style={{ paddingBottom: 64 }}>
        <Link className={styles.link} href="/coming-soon?role=buyer">
          See the planned launch and countdown <ArrowRight size={16} />
        </Link>
      </section>
    </main>
  );
}
