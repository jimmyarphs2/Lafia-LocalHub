import { afterEach, describe, expect, it } from "vitest";
import { getPublicAppUrl, isDemoMode } from "@/lib/market/public-url";

const originalDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE;
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalPhase = process.env.NEXT_PHASE;

afterEach(() => {
  if (originalDemoMode === undefined) {
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
  } else {
    process.env.NEXT_PUBLIC_DEMO_MODE = originalDemoMode;
  }
  if (originalAppUrl === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  }
  if (originalPhase === undefined) {
    delete process.env.NEXT_PHASE;
  } else {
    process.env.NEXT_PHASE = originalPhase;
  }
});

describe("demo mode", () => {
  it("defaults to safe demo mode when no setting is present", () => {
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    expect(isDemoMode()).toBe(true);
  });

  it("keeps explicit true in demo mode", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    expect(isDemoMode()).toBe(true);
  });

  it("requires an explicit false to enable live indexing", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    expect(isDemoMode()).toBe(false);
  });

  it("requires an HTTPS public origin for live builds while preserving demo build fallback", () => {
    process.env.NEXT_PHASE = "phase-production-build";
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    expect(getPublicAppUrl().toString()).toBe("http://localhost:3000/");

    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    expect(() => getPublicAppUrl()).toThrow("must be configured");

    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    expect(() => getPublicAppUrl()).toThrow("must use HTTPS");

    process.env.NEXT_PUBLIC_APP_URL = "https://localhub.test";
    expect(getPublicAppUrl().toString()).toBe("https://localhub.test/");
  });
});
