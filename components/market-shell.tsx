import {
  ClipboardList,
  Home,
  MapPin,
  Search,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { BrandMark } from "./brand-mark";
import type { Market } from "@/lib/market/config";
import { isDemoMode } from "@/lib/market/public-url";
import { MarketFooter } from "./market-footer";
export function MarketShell({
  market,
  children,
}: {
  market: Market;
  children: React.ReactNode;
}) {
  const demoMode = isDemoMode();
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container header-row">
          <BrandMark />
          <nav className="header-nav" aria-label="Primary navigation">
            <Link href={`/${market.slug}`}>Explore</Link>
            <Link href={`/${market.slug}/activity`}>Activity</Link>
            <Link className="market-switcher" href={`/${market.slug}`}>
              <MapPin aria-hidden="true" size={17} /> {market.name}
            </Link>
            <Link aria-label="Sign in" href="/auth">
              <UserRound aria-hidden="true" size={17} /> <span>Sign in</span>
            </Link>
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
      <MobileCustomerNav market={market} />
      <MarketFooter market={market} />
    </>
  );
}

function AccountIntentButton({
  market,
  destination,
  label,
  icon: Icon,
}: {
  market: Market;
  destination: "profile";
  label: string;
  icon: typeof ClipboardList;
}) {
  return (
    <form action="/auth/intent" method="post">
      <input name="action" type="hidden" value="continue" />
      <input name="return_to" type="hidden" value={`/${market.slug}`} />
      <input
        name="payload"
        type="hidden"
        value={JSON.stringify({
          type: "account_navigation",
          destination,
          market: market.slug,
        })}
      />
      <button type="submit">
        <Icon aria-hidden="true" size={20} />
        <span>{label}</span>
      </button>
    </form>
  );
}

function MobileCustomerNav({ market }: { market: Market }) {
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
      <AccountIntentButton
        market={market}
        destination="profile"
        label="Profile"
        icon={UserRound}
      />
    </nav>
  );
}
