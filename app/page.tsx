import { LocalHubEntry } from "@/components/localhub-entry";
import { getCurrentIdentity } from "@/lib/auth/identity";
import { isAuthRuntimeReady } from "@/lib/auth/runtime";
import { getPublicSupabaseConfig } from "@/lib/config/env";
import { getEntryMarkets } from "@/lib/market/entry-markets";

export default async function Home() {
  const [identity, directory] = await Promise.all([
    getCurrentIdentity(),
    getEntryMarkets(),
  ]);
  const authAvailable =
    Boolean(getPublicSupabaseConfig()) && isAuthRuntimeReady();
  return (
    <LocalHubEntry
      identity={identity}
      markets={directory.markets}
      directoryState={directory.state}
      demoMode={directory.demoMode}
      authAvailable={authAvailable}
    />
  );
}
