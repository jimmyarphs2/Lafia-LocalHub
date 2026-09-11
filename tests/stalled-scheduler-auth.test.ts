import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getConfiguredStalledSchedulerSecret,
  isAuthorizedStalledSchedulerRequest,
} from "@/lib/onboarding/stalled-scheduler-auth";

const secret = "s".repeat(32);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("stalled onboarding scheduler authorization", () => {
  it("fails closed when the dedicated secret is missing or malformed", () => {
    expect(getConfiguredStalledSchedulerSecret()).toBeNull();

    vi.stubEnv("ONBOARDING_STALLED_CRON_SECRET", "short");
    expect(getConfiguredStalledSchedulerSecret()).toBeNull();

    vi.stubEnv("ONBOARDING_STALLED_CRON_SECRET", ` ${secret}`);
    expect(getConfiguredStalledSchedulerSecret()).toBeNull();
  });

  it("accepts only the exact bearer secret", () => {
    vi.stubEnv("ONBOARDING_STALLED_CRON_SECRET", secret);

    const configured = getConfiguredStalledSchedulerSecret();
    expect(configured).toBe(secret);

    expect(
      isAuthorizedStalledSchedulerRequest(
        new Request("https://localhub.test/api/internal/onboarding/stalled", {
          headers: { authorization: `Bearer ${secret}` },
        }),
        secret,
      ),
    ).toBe(true);

    expect(
      isAuthorizedStalledSchedulerRequest(
        new Request("https://localhub.test/api/internal/onboarding/stalled", {
          headers: { authorization: `Bearer ${"x".repeat(32)}` },
        }),
        secret,
      ),
    ).toBe(false);

    expect(
      isAuthorizedStalledSchedulerRequest(
        new Request("https://localhub.test/api/internal/onboarding/stalled"),
        secret,
      ),
    ).toBe(false);
  });
});
