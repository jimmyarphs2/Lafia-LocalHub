import { createHmac } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthRateLimitScope =
  | "guest_intent"
  | "email_sign_in"
  | "oauth_sign_in"
  | "auth_callback"
  | "intent_resume";

type RateLimitResult = "allowed" | "limited" | "unavailable";

const ipv4Pattern =
  /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const ipv6Pattern = /^[0-9a-f:.]{3,64}$/i;
const MIN_HMAC_KEY_BYTES = 32;

export function getConfiguredAuthRateLimitHmacKey(): string | null {
  const key = process.env.AUTH_RATE_LIMIT_HMAC_KEY;
  if (
    !key ||
    Buffer.byteLength(key, "utf8") < MIN_HMAC_KEY_BYTES ||
    /\s/.test(key) ||
    key.trim() !== key
  ) {
    return null;
  }
  return key;
}

function trustedClientAddress(request: Request): string | null {
  if (process.env.NODE_ENV !== "production") return "development";

  const ingress = process.env.AUTH_TRUSTED_INGRESS;
  const rawAddress =
    ingress === "cloudflare"
      ? request.headers.get("cf-connecting-ip")
      : ingress === "vercel"
        ? request.headers.get("x-vercel-forwarded-for")
        : null;
  const address = rawAddress?.split(",", 1)[0]?.trim();

  return address && (ipv4Pattern.test(address) || ipv6Pattern.test(address))
    ? address.toLowerCase()
    : null;
}

/**
 * Returns a stable, HMAC-peppered request key only when the deployment has
 * declared an ingress that overwrites the forwarded-address header.
 */
export function getAuthRateLimitIdentifier(request: Request): string | null {
  const address = trustedClientAddress(request);
  if (!address) return null;
  const configuredPepper = getConfiguredAuthRateLimitHmacKey();
  if (!configuredPepper && process.env.NODE_ENV === "production") return null;
  return createHmac(
    "sha256",
    configuredPepper || "development-only-rate-limit-key",
  )
    .update(`localhub-auth:${address}`)
    .digest("hex");
}

/** Durable, atomic limiter implemented by the database RPC, never process memory. */
export async function consumeAuthRateLimit(
  client: SupabaseClient,
  scope: AuthRateLimitScope,
  request: Request,
): Promise<RateLimitResult> {
  const identifier = getAuthRateLimitIdentifier(request);
  if (!identifier) return "unavailable";

  try {
    const { data, error } = await client.rpc("consume_auth_rate_limit", {
      p_scope: scope,
      p_identifier: identifier,
    });
    if (error || typeof data !== "boolean") return "unavailable";
    return data ? "allowed" : "limited";
  } catch {
    return "unavailable";
  }
}
