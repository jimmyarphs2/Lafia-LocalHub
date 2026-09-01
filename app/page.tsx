import Link from "next/link";
import { ArrowRight, MapPin, Search } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { AccountMenu } from "@/components/account-menu";
import { MarketFooter } from "@/components/market-footer";
import { getCurrentIdentity } from "@/lib/auth/identity";
import { getLaunchMarket } from "@/lib/market/config";
import { isDemoMode } from "@/lib/market/public-url";

export default async function Home() {
  const market = getLaunchMarket();
  const demoMode = isDemoMode();
  const identity = await getCurrentIdentity();
  return (
    <div className="welcome-page">
      <header className="welcome-header container">
        <BrandMark />
        <div className="welcome-actions">
          <Link className="text-link" href={`/${market.slug}`}>
            Browse {demoMode ? "the Lafia demo" : market.name}{" "}
            <ArrowRight aria-hidden="true" size={17} />
          </Link>
          <AccountMenu identity={identity} marketSlug={market.slug} />
        </div>
      </header>
      <main className="welcome-main container">
        <h1>
          Find the people and businesses that keep your neighbourhood moving.
        </h1>
        <p className="lede">
          LocalHub is a guest-first local marketplace. Explore the launch
          experience in Lafia—no account required to browse.
        </p>
        <Link className="button button-primary" href={`/${market.slug}`}>
          <Search aria-hidden="true" size={19} /> Explore {market.name}
        </Link>
        <p className="market-note">
          <MapPin aria-hidden="true" size={17} /> {market.region}, Nigeria
        </p>
      </main>
      <MarketFooter market={market} />
    </div>
  );
}
