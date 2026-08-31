import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

const MIN_CLEANUP_SECRET_LENGTH = 32;
const BEARER_TOKEN = /^Bearer ([^\s]+)$/;

/**
 * Reads the dedicated cleanup credential without normalizing it. Leading or
 * trailing whitespace is rejected so deployment mistakes fail closed.
 */
export function getConfiguredMediaCleanupSecret(): string | null {
  const secret = process.env.MEDIA_CLEANUP_SECRET;
  if (
    !secret ||
    secret.length < MIN_CLEANUP_SECRET_LENGTH ||
    /\s/.test(secret) ||
    secret.trim() !== secret
  ) {
    return null;
  }

  return secret;
}

function digestSecret(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Compares fixed-length digests so valid-looking credentials use constant time. */
export function isAuthorizedMediaCleanupRequest(
  request: Request,
  configuredSecret: string,
): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  const match = BEARER_TOKEN.exec(authorization);
  const rawSuppliedSecret = match?.[1] ?? "";
  const suppliedSecret =
    rawSuppliedSecret.length >= MIN_CLEANUP_SECRET_LENGTH
      ? rawSuppliedSecret
      : "";

  const matches = timingSafeEqual(
    digestSecret(suppliedSecret),
    digestSecret(configuredSecret),
  );

  return match !== null && suppliedSecret.length > 0 && matches;
}
