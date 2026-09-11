import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

const MIN_SCHEDULER_SECRET_LENGTH = 32;
const BEARER_TOKEN = /^Bearer ([^\s]+)$/;

export function getConfiguredStalledSchedulerSecret(): string | null {
  const secret = process.env.ONBOARDING_STALLED_CRON_SECRET;
  if (
    !secret ||
    secret.length < MIN_SCHEDULER_SECRET_LENGTH ||
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

export function isAuthorizedStalledSchedulerRequest(
  request: Request,
  configuredSecret: string,
): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  const match = BEARER_TOKEN.exec(authorization);
  const rawSuppliedSecret = match?.[1] ?? "";
  const suppliedSecret =
    rawSuppliedSecret.length >= MIN_SCHEDULER_SECRET_LENGTH
      ? rawSuppliedSecret
      : "";

  const matches = timingSafeEqual(
    digestSecret(suppliedSecret),
    digestSecret(configuredSecret),
  );

  return match !== null && suppliedSecret.length > 0 && matches;
}
