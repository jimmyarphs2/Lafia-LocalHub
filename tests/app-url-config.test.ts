import { afterEach, describe, expect, it, vi } from "vitest";

import { getAppOrigin, getAppUrl } from "@/lib/config/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("application URL configuration", () => {
  it("uses localhost only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    expect(getAppUrl().toString()).toBe("http://localhost:3000/");
  });

  it("fails closed when the production URL is missing or invalid", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(() => getAppUrl()).toThrow(/valid HTTPS URL/);

    vi.stubEnv("NEXT_PUBLIC_APP_URL", "not-a-url");
    expect(() => getAppOrigin()).toThrow(/valid HTTPS URL/);
  });

  it("rejects HTTP origins and accepts an HTTPS production origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(() => getAppUrl()).toThrow(/must use HTTPS/);

    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://localhub.example");
    expect(getAppOrigin()).toBe("https://localhub.example");
  });
});
