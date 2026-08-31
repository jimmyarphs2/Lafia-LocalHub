import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const routeMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getPublicSupabaseConfig: vi.fn(),
  publicClient: { rpc: vi.fn() },
  resolveReferralAcquisitionLink: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: routeMocks.createClient,
}));
vi.mock("@/lib/config/env", () => ({
  getAppUrl: () => new URL("http://localhost:3000"),
  getPublicSupabaseConfig: routeMocks.getPublicSupabaseConfig,
}));
vi.mock("@/lib/referrals/rpc", () => ({
  resolveReferralAcquisitionLink: routeMocks.resolveReferralAcquisitionLink,
}));

import { NextRequest } from "next/server";

import * as resolverRoute from "@/app/r/[code]/route";

const validCode = "a".repeat(32);
const canonicalPath = "/lafia/vendor/onboarding/referral";

function request(code: string) {
  return new NextRequest(`http://localhost:3000/r/${encodeURIComponent(code)}`);
}

function context(code: string) {
  return { params: Promise.resolve({ code }) };
}

function expectGenericRedirect(response: Response, code = validCode) {
  const location = new URL(response.headers.get("location")!);
  expect(response.status).toBe(303);
  expect(location.pathname).toBe("/vendor/onboarding");
  expect(location.search).toBe("");
  expect(location.hash).toBe("");
  expect(location.toString()).not.toContain(code);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("set-cookie")).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  routeMocks.getPublicSupabaseConfig.mockReturnValue({
    url: "https://localhub.supabase.test",
    anonKey: "test-publishable-key",
  });
  routeMocks.createClient.mockReturnValue(routeMocks.publicClient);
  routeMocks.resolveReferralAcquisitionLink.mockResolvedValue({
    resolution: {
      outcome: "valid",
      marketSlug: "lafia",
      target: "merchant_onboarding",
      canonicalTargetPath: canonicalPath,
      expiresAt: null,
    },
    error: null,
  });
});

describe("public referral resolver route", () => {
  it("exports only GET and is explicitly dynamic", () => {
    expect("POST" in resolverRoute).toBe(false);
    expect(resolverRoute.dynamic).toBe("force-dynamic");
  });

  it.each(["short", "A".repeat(32), `${"a".repeat(31)}g`])(
    "rejects malformed code %s before client or RPC construction",
    async (code) => {
      const response = await resolverRoute.GET(request(code), context(code));

      expectGenericRedirect(response, code);
      expect(routeMocks.getPublicSupabaseConfig).not.toHaveBeenCalled();
      expect(routeMocks.createClient).not.toHaveBeenCalled();
      expect(routeMocks.resolveReferralAcquisitionLink).not.toHaveBeenCalled();
    },
  );

  it("resolves once through an anonymous public client and redirects canonically", async () => {
    const response = await resolverRoute.GET(
      request(validCode),
      context(validCode),
    );
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(303);
    expect(location.pathname).toBe(canonicalPath);
    expect(location.search).toBe("");
    expect(location.hash).toBe("");
    expect(location.toString()).not.toContain(validCode);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(routeMocks.createClient).toHaveBeenCalledTimes(1);
    expect(routeMocks.createClient).toHaveBeenCalledWith(
      "https://localhub.supabase.test",
      "test-publishable-key",
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
    expect(routeMocks.resolveReferralAcquisitionLink).toHaveBeenCalledTimes(1);
    expect(routeMocks.resolveReferralAcquisitionLink).toHaveBeenCalledWith(
      routeMocks.publicClient,
      validCode,
    );
  });

  it.each([
    [
      "invalid",
      {
        resolution: {
          outcome: "invalid",
          marketSlug: null,
          target: null,
          canonicalTargetPath: null,
          expiresAt: null,
        },
        error: null,
      },
    ],
    [
      "expired",
      {
        resolution: {
          outcome: "expired",
          marketSlug: "lafia",
          target: "merchant_onboarding",
          canonicalTargetPath: canonicalPath,
          expiresAt: "2026-08-31T00:00:00.000Z",
        },
        error: null,
      },
    ],
    ["provider failure", { resolution: null, error: { kind: "provider" } }],
    ["contract failure", { resolution: null, error: { kind: "contract" } }],
    [
      "mismatched canonical response",
      {
        resolution: {
          outcome: "valid",
          marketSlug: "lafia",
          target: "merchant_onboarding",
          canonicalTargetPath: "/another-market/vendor/onboarding/referral",
          expiresAt: null,
        },
        error: null,
      },
    ],
  ])(
    "makes %s indistinguishable from the generic fallback",
    async (_label, result) => {
      routeMocks.resolveReferralAcquisitionLink.mockResolvedValue(result);

      const response = await resolverRoute.GET(
        request(validCode),
        context(validCode),
      );

      expectGenericRedirect(response);
    },
  );

  it("uses the same generic fallback for missing configuration and thrown failures", async () => {
    routeMocks.getPublicSupabaseConfig.mockReturnValueOnce(null);
    const unconfigured = await resolverRoute.GET(
      request(validCode),
      context(validCode),
    );
    expectGenericRedirect(unconfigured);
    expect(routeMocks.createClient).not.toHaveBeenCalled();
    expect(routeMocks.resolveReferralAcquisitionLink).not.toHaveBeenCalled();

    routeMocks.resolveReferralAcquisitionLink.mockRejectedValueOnce(
      new Error("provider unavailable"),
    );
    const unavailable = await resolverRoute.GET(
      request(validCode),
      context(validCode),
    );
    expectGenericRedirect(unavailable);
  });

  it("contains no privileged client, cookie mutation, logging, or direct RPC", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app", "r", "[code]", "route.ts"),
      "utf8",
    );

    expect(source).not.toContain("supabase/admin");
    expect(source).not.toContain("getServerAdminSupabaseClient");
    expect(source).not.toMatch(/cookies?\.set|response\.cookies/i);
    expect(source).not.toMatch(/console\.|\.rpc\s*\(/);
  });
});
