import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getConfiguredMediaCleanupSecret,
  isAuthorizedMediaCleanupRequest,
} from "@/lib/media/cleanup-auth";

afterEach(() => {
  vi.unstubAllEnvs();
});

function requestWithAuthorization(value?: string) {
  return new Request("https://localhub.example/api/internal/media/cleanup", {
    method: "POST",
    headers: value ? { authorization: value } : undefined,
  });
}

describe("media cleanup credential boundary", () => {
  it("accepts only configured secrets that are at least 32 characters", () => {
    vi.stubEnv("MEDIA_CLEANUP_SECRET", "x".repeat(31));
    expect(getConfiguredMediaCleanupSecret()).toBeNull();

    vi.stubEnv("MEDIA_CLEANUP_SECRET", ` ${"x".repeat(32)}`);
    expect(getConfiguredMediaCleanupSecret()).toBeNull();

    vi.stubEnv("MEDIA_CLEANUP_SECRET", "x".repeat(32));
    expect(getConfiguredMediaCleanupSecret()).toBe("x".repeat(32));
  });

  it("requires an exact bearer credential", () => {
    const secret = "cleanup-secret-0123456789-abcdefghij";

    expect(
      isAuthorizedMediaCleanupRequest(
        requestWithAuthorization(`Bearer ${secret}`),
        secret,
      ),
    ).toBe(true);
    expect(
      isAuthorizedMediaCleanupRequest(
        requestWithAuthorization(`Bearer ${secret.slice(0, -1)}x`),
        secret,
      ),
    ).toBe(false);
    expect(
      isAuthorizedMediaCleanupRequest(
        requestWithAuthorization(`Basic ${secret}`),
        secret,
      ),
    ).toBe(false);
    expect(
      isAuthorizedMediaCleanupRequest(requestWithAuthorization(), secret),
    ).toBe(false);
  });
});
