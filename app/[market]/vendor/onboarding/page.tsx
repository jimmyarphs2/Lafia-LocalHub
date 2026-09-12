import { redirect } from "next/navigation";

/**
 * Keep market-scoped entry links compatible while the authenticated vendor
 * workspace remains a single canonical route.
 */
export default function MarketVendorOnboardingRedirect() {
  redirect("/vendor/onboarding");
}
