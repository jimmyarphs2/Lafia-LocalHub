import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import styles from "@/components/admin/business-triage.module.css";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className={styles.route}>
      <a className={styles.skipLink} href="#admin-main">
        Skip to operations workspace
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <BrandMark />
          <span className={styles.workspaceLabel}>LocalHub operations</span>
        </div>
      </header>
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <strong>Command centre</strong>
          <nav aria-label="Admin tools">
            <Link aria-current="page" href="/admin/business-reviews">
              Business triage
            </Link>
          </nav>
        </aside>
        <main className={styles.main} id="admin-main">
          {children}
        </main>
      </div>
    </div>
  );
}
