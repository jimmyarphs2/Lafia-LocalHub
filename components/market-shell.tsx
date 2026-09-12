import {
  ClipboardList,
  Bell,
  Home,
  MapPin,
  Search,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { AccountMenu } from "./account-menu";
import type { AuthIdentity } from "@/lib/auth/identity";
import { getCurrentIdentity } from "@/lib/auth/identity";
import type { Market } from "@/lib/market/config";
import { isDemoMode } from "@/lib/market/public-url";
import { MarketFooter } from "./market-footer";
import { ThemeSwitcher } from "./theme-switcher";
export async function MarketShell({
  market,
  children,
}: {
  market: Market;
  children: React.ReactNode;
}) {
  const demoMode = isDemoMode();
  const identity = await getCurrentIdentity();
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container header-row">
          <BrandMark />
          <nav className="header-nav" aria-label="Primary navigation">
            <Link className="desktop-nav-link" href={`/${market.slug}`}>
              Explore
            </Link>
            <Link
              className="desktop-nav-link"
              href={`/${market.slug}/activity`}
            >
              Activity
            </Link>
            <Link className="market-switcher" href={`/${market.slug}`}>
              <MapPin aria-hidden="true" size={17} /> {market.name}
            </Link>
            <ThemeSwitcher />
            <Link
              aria-label="View activity"
              className="header-icon-link"
              href={`/${market.slug}/activity`}
            >
              <Bell aria-hidden="true" size={19} />
            </Link>
            <AccountMenu identity={identity} marketSlug={market.slug} />
          </nav>
        </div>
      </header>
      {demoMode ? (
        <div className="notice">
          <div className="container">
            <strong>Demo directory:</strong> all businesses and listings shown
            here are fictional examples for product discovery testing.
          </div>
        </div>
      ) : null}
      <main className="main" id="main-content">
        {children}
      </main>
      <MobileCustomerNav identity={identity} market={market} />
      <MarketFooter market={market} />
    </>
  );
}

function MobileCustomerNav({
  identity,
  market,
}: {
  identity: AuthIdentity | null;
  market: Market;
}) {
  return (
    <nav className="mobile-nav" aria-label="Customer navigation">
      <Link href={`/${market.slug}`}>
        <Home aria-hidden="true" size={20} />
        <span>Home</span>
      </Link>
      <Link href={`/${market.slug}/search`}>
        <Search aria-hidden="true" size={20} />
        <span>Explore</span>
      </Link>
      <Link className="mobile-ask" href={`/${market.slug}/search`}>
        <Sparkles aria-hidden="true" size={24} />
        <span>Ask</span>
      </Link>
      <Link href={`/${market.slug}/activity`}>
        <ClipboardList aria-hidden="true" size={20} />
        <span>Activity</span>
      </Link>
      <Link
        href={
          identity
            ? `/${market.slug}/account`
            : `/auth?next=${encodeURIComponent(`/${market.slug}/account`)}`
        }
      >
        <UserRound aria-hidden="true" size={20} />
        <span>{identity ? "Profile" : "Sign in"}</span>
      </Link>
    </nav>
  );
}
