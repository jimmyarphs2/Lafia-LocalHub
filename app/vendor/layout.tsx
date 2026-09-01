import { ArrowLeft } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { AccountMenu } from "@/components/account-menu";
import { DraftNavigationLink } from "@/components/vendor/draft-navigation-link";
import styles from "@/components/vendor/vendor-onboarding.module.css";
import { getCurrentIdentity } from "@/lib/auth/identity";

export default async function VendorLayout({
  children,
}: LayoutProps<"/vendor">) {
  const identity = await getCurrentIdentity();
  const activeIdentity = identity?.accessState === "active" ? identity : null;
  const vendorBusiness =
    activeIdentity?.role === "vendor" ? activeIdentity.business : null;
  const canStartBusiness = activeIdentity?.role === "customer";
  return (
    <div className={styles.route}>
      <a className={styles.skipLink} href="#vendor-main">
        Skip to vendor workspace
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <BrandMark guardDraftNavigation />
          <div className={styles.headerActions}>
            <DraftNavigationLink className={styles.marketLink} href="/lafia">
              <ArrowLeft aria-hidden="true" size={17} /> Browse LocalHub
            </DraftNavigationLink>
            <AccountMenu identity={identity} marketSlug="lafia" />
          </div>
        </div>
        {canStartBusiness || vendorBusiness ? (
          <nav aria-label="Vendor tools" className={styles.vendorNav}>
            <div className={styles.vendorNavInner}>
              <DraftNavigationLink href="/vendor/onboarding">
                Business setup
              </DraftNavigationLink>
              {vendorBusiness?.canManageListings ? (
                <>
                  <DraftNavigationLink href="/vendor/listings">
                    Listing drafts
                  </DraftNavigationLink>
                  <DraftNavigationLink href="/vendor/media-lab">
                    Media lab
                  </DraftNavigationLink>
                </>
              ) : null}
              {vendorBusiness ? (
                <>
                  <DraftNavigationLink href="/vendor/requests">
                    Request inbox
                  </DraftNavigationLink>
                  <DraftNavigationLink href="/vendor/orders">
                    Order inbox
                  </DraftNavigationLink>
                </>
              ) : null}
            </div>
          </nav>
        ) : null}
      </header>
      <main className={styles.main} id="vendor-main">
        {children}
      </main>
    </div>
  );
}
