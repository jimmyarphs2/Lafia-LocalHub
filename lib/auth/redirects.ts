import { z } from "zod";

import { getAppOrigin } from "@/lib/config/env";

const GUEST_INTENT_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-localhub-intent"
    : "localhub-intent";
const AUTH_RETURN_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-localhub-auth-return"
    : "localhub-auth-return";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASCII_CONTROL_OR_WHITESPACE = /[\u0000-\u0020\u007f]/;
const PKCE_FLOW_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const intentCookieSchema = z.object({
  id: z.string().uuid(),
  secret: z.string().min(32).max(256),
});
const authReturnCookieSchema = z
  .object({ returnTo: z.string().min(1).max(2048) })
  .strict();

export const GUEST_INTENT_TTL_SECONDS = 15 * 60;
export const AUTH_RETURN_TTL_SECONDS = 15 * 60;

export { AUTH_RETURN_COOKIE, GUEST_INTENT_COOKIE };

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

/** A completed auth flow may never return into the auth controller itself. */
export function safeAuthReturnPath(
  value: string | null | undefined,
  fallback = "/",
) {
  const destination = safeReturnPath(value, fallback);
  try {
    const pathname = new URL(destination, getAppOrigin()).pathname;
    return pathname === "/auth" || pathname.startsWith("/auth/")
      ? fallback
      : destination;
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

/** Keeps the intended internal destination out of provider callback URLs. */
export function serializeAuthReturnCookie(value: string | null | undefined) {
  const safeValue = safeAuthReturnPath(value);
  const returnTo =
    Buffer.byteLength(safeValue, "utf8") <= 2048 ? safeValue : "/";
  return Buffer.from(JSON.stringify({ returnTo }), "utf8").toString(
    "base64url",
  );
}

export function parseAuthReturnCookie(
  value: string | undefined,
): string | null {
  // A 2 KiB UTF-8 path encodes below this bound; reject oversized input before
  // allocating decoded/parsed structures for attacker-controlled cookies.
  if (!value || value.length > 4096) return null;
  try {
    const parsed = authReturnCookieSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return parsed.success ? safeAuthReturnPath(parsed.data.returnTo) : null;
  } catch {
    return null;
  }
}

export function parsePkceFlowId(value: string | null | undefined) {
  return value && PKCE_FLOW_ID_PATTERN.test(value) ? value : null;
}

export function parseAuthReturnState(value: string | null | undefined) {
  return z.string().uuid().safeParse(value).data ?? null;
}

export function authReturnCookieName(flowId?: string | null) {
  const validFlowId = parsePkceFlowId(flowId);
  return validFlowId
    ? `${AUTH_RETURN_COOKIE}-${validFlowId}`
    : AUTH_RETURN_COOKIE;
}

export function authReturnStateCookieName(state: string | null | undefined) {
  const validState = parseAuthReturnState(state);
  return validState ? `${AUTH_RETURN_COOKIE}-state-${validState}` : null;
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

export function authReturnCookieOptions() {
  return {
    httpOnly: true,
    maxAge: AUTH_RETURN_TTL_SECONDS,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

/** Shared hardening for all server-managed Supabase session/PKCE cookies. */
export function supabaseAuthCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

/** Prevents auth responses carrying cookies from being cached by a proxy/CDN. */
export function applyAuthResponseHeaders(
  responseHeaders: Headers,
  authHeaders: Record<string, string> = {},
) {
  responseHeaders.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  responseHeaders.set("Expires", "0");
  responseHeaders.set("Pragma", "no-cache");
  Object.entries(authHeaders).forEach(([name, value]) =>
    responseHeaders.set(name, value),
  );
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
