import { z } from "zod";

import { getAppOrigin } from "@/lib/config/env";

const GUEST_INTENT_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-localhub-intent"
    : "localhub-intent";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASCII_CONTROL_OR_WHITESPACE = /[\u0000-\u0020\u007f]/;
const intentCookieSchema = z.object({
  id: z.string().uuid(),
  secret: z.string().min(32).max(256),
});

export const GUEST_INTENT_TTL_SECONDS = 15 * 60;

export { GUEST_INTENT_COOKIE };

/** Allows only internal paths; prevents OAuth and magic-link open redirects. */
export function safeReturnPath(
  value: string | null | undefined,
  fallback = "/",
): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    ASCII_CONTROL_OR_WHITESPACE.test(value)
  ) {
    return fallback;
  }
  try {
    const appOrigin = getAppOrigin();
    const destination = new URL(value, appOrigin);
    return destination.origin === appOrigin ? value : fallback;
  } catch {
    return fallback;
  }
}

export function serializeGuestIntentCookie(id: string, secret: string): string {
  if (
    !UUID_PATTERN.test(id) ||
    !intentCookieSchema.shape.secret.safeParse(secret).success
  )
    throw new Error("Invalid guest intent capability.");
  return Buffer.from(JSON.stringify({ id, secret }), "utf8").toString(
    "base64url",
  );
}

export function parseGuestIntentCookie(
  value: string | undefined,
): { id: string; secret: string } | null {
  if (!value) return null;
  try {
    return (
      intentCookieSchema.safeParse(
        JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
      ).data ?? null
    );
  } catch {
    return null;
  }
}

export function authCookieOptions() {
  return {
    httpOnly: true,
    maxAge: GUEST_INTENT_TTL_SECONDS,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === getAppOrigin();
  } catch {
    return false;
  }
}

export function safeAuthError(value: string | null): string | null {
  return value === "auth_failed" || value === "configuration" ? value : null;
}
