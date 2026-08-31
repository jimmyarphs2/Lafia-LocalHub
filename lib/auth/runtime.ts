import "server-only";

import { getConfiguredAuthRateLimitHmacKey } from "@/lib/auth/rate-limit";
import { getServerAdminSupabaseClient } from "@/lib/supabase/admin";

/** Configuration-only readiness check; it never exposes server secret values. */
export function isAuthRuntimeReady() {
  if (!getServerAdminSupabaseClient()) return false;
  if (process.env.NODE_ENV !== "production") return true;
  return (
    Boolean(getConfiguredAuthRateLimitHmacKey()) &&
    (process.env.AUTH_TRUSTED_INGRESS === "cloudflare" ||
      process.env.AUTH_TRUSTED_INGRESS === "vercel")
  );
}
