import { ArrowLeft } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { DraftNavigationLink } from "@/components/vendor/draft-navigation-link";
import styles from "@/components/vendor/vendor-onboarding.module.css";

export default function VendorLayout({ children }: LayoutProps<"/vendor">) {
  return (
    <div className={styles.route}>
      <a className={styles.skipLink} href="#vendor-main">
        Skip to vendor workspace
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <BrandMark guardDraftNavigation />
          <DraftNavigationLink className={styles.marketLink} href="/lafia">
            <ArrowLeft aria-hidden="true" size={17} /> Browse LocalHub
          </DraftNavigationLink>
        </div>
        <nav aria-label="Vendor tools" className={styles.vendorNav}>
          <div className={styles.vendorNavInner}>
            <DraftNavigationLink href="/vendor/onboarding">
              Business setup
            </DraftNavigationLink>
            <DraftNavigationLink href="/vendor/listings">
              Listing drafts
            </DraftNavigationLink>
            <DraftNavigationLink href="/vendor/media-lab">
              Media lab
            </DraftNavigationLink>
            <DraftNavigationLink href="/vendor/requests">
              Request inbox
            </DraftNavigationLink>
            <DraftNavigationLink href="/vendor/orders">
              Order inbox
            </DraftNavigationLink>
          </div>
        </nav>
      </header>
      <main className={styles.main} id="vendor-main">
        {children}
      </main>
    </div>
  );
}
