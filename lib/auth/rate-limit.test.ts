import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAuthRateLimitIdentifier,
  getConfiguredAuthRateLimitHmacKey,
} from "./rate-limit";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth rate-limit request identity", () => {
  it("uses a bounded, non-reversible development identity", () => {
    const identifier = getAuthRateLimitIdentifier(
      new Request("http://localhost"),
    );
    expect(identifier).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects production HMAC keys shorter than 32 bytes", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_TRUSTED_INGRESS", "cloudflare");
    vi.stubEnv("AUTH_RATE_LIMIT_HMAC_KEY", "x".repeat(31));
    const request = new Request("https://localhub.test/auth", {
      headers: { "cf-connecting-ip": "203.0.113.10" },
    });

    expect(getConfiguredAuthRateLimitHmacKey()).toBeNull();
    expect(getAuthRateLimitIdentifier(request)).toBeNull();
  });

  it("accepts a whitespace-free production HMAC key of at least 32 bytes", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_TRUSTED_INGRESS", "vercel");
    vi.stubEnv("AUTH_RATE_LIMIT_HMAC_KEY", "x".repeat(32));
    const request = new Request("https://localhub.test/auth", {
      headers: { "x-vercel-forwarded-for": "2001:db8::1" },
    });

    expect(getConfiguredAuthRateLimitHmacKey()).toBe("x".repeat(32));
    expect(getAuthRateLimitIdentifier(request)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects surrounding or embedded whitespace", () => {
    vi.stubEnv("AUTH_RATE_LIMIT_HMAC_KEY", ` ${"x".repeat(32)}`);
    expect(getConfiguredAuthRateLimitHmacKey()).toBeNull();
    vi.stubEnv(
      "AUTH_RATE_LIMIT_HMAC_KEY",
      `${"x".repeat(16)} ${"x".repeat(16)}`,
    );
    expect(getConfiguredAuthRateLimitHmacKey()).toBeNull();
  });
});
