import type { Market } from "@/lib/market/config";
import { isDemoMode } from "@/lib/market/public-url";
export function MarketFooter({ market }: { market: Market }) {
  const demoMode = isDemoMode();
  return (
    <footer className="site-footer">
      <div className="container footer-row">
        <p>© {new Date().getFullYear()} LocalHub</p>
        <p>
          {demoMode
            ? `${market.name} is a fictional launch-market demonstration. No live availability, pricing, or business claims are shown.`
            : `Only verified, publishable ${market.name} records are shown.`}
        </p>
      </div>
    </footer>
  );
}
