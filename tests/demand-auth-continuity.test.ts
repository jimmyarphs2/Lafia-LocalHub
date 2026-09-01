import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  consumeAuthRateLimit: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({
  getAppOrigin: () => "http://localhost:3000",
  getAppUrl: () => new URL("http://localhost:3000"),
  getPublicSupabaseConfig: () => ({
    anonKey: "test-anon-key",
    url: "https://localhub.supabase.test",
  }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      exchangeCodeForSession: authMocks.exchangeCodeForSession,
      getUser: authMocks.getUser,
    },
    rpc: authMocks.rpc,
  }),
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  consumeAuthRateLimit: authMocks.consumeAuthRateLimit,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getServerAdminSupabaseClient: () => ({}),
}));

import { NextRequest } from "next/server";

import { GET as authCallback } from "@/app/auth/callback/route";
import { POST as authResume } from "@/app/auth/resume/route";
import {
  AUTH_RETURN_COOKIE,
  serializeAuthReturnCookie,
} from "@/lib/auth/redirects";

const intentId = "11111111-1111-4111-8111-111111111111";
const categoryId = "22222222-2222-4222-8222-222222222222";
const demandPath = `/lafia/demand/confirm?category=${categoryId}`;
const validCookie = Buffer.from(
  JSON.stringify({ id: intentId, secret: "s".repeat(32) }),
  "utf8",
).toString("base64url");

function callbackRequest(cookie: string) {
  const destination = new URL("http://localhost:3000/auth/callback");
  destination.searchParams.set("code", "auth-code");
  return new NextRequest(destination, {
    headers: {
      cookie: `localhub-intent=${cookie}; ${AUTH_RETURN_COOKIE}=${serializeAuthReturnCookie(demandPath)}`,
    },
  });
}

function resumeRequest(cookie: string) {
  return new NextRequest("http://localhost:3000/auth/resume", {
    body: new URLSearchParams({ intent: intentId, next: demandPath }),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `localhub-intent=${cookie}; ${AUTH_RETURN_COOKIE}=${serializeAuthReturnCookie(demandPath)}`,
      origin: "http://localhost:3000",
    },
    method: "POST",
  });
}

describe("demand authentication continuity", () => {
  beforeEach(() => {
    authMocks.consumeAuthRateLimit.mockReset();
    authMocks.consumeAuthRateLimit.mockResolvedValue("allowed");
    authMocks.exchangeCodeForSession.mockReset();
    authMocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    authMocks.getUser.mockReset();
    authMocks.getUser.mockResolvedValue({
      data: { user: { id: "authenticated-account" } },
      error: null,
    });
    authMocks.rpc.mockReset();
  });

  it.each([
    [
      "claim success",
      validCookie,
      { data: { outcome: "claimed" }, error: null },
    ],
    [
      "transient claim",
      validCookie,
      { data: null, error: { code: "network" } },
    ],
    [
      "terminal claim",
      validCookie,
      { data: { outcome: "claimed_by_other" }, error: null },
    ],
    ["malformed capability", "not-base64-json", { data: null, error: null }],
  ])(
    "returns directly to demand and preserves a pre-existing %s cookie",
    async (_label, cookie, claimResult) => {
      authMocks.rpc.mockResolvedValue(claimResult);

      const response = await authCallback(callbackRequest(cookie));

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        `http://localhost:3000${demandPath}`,
      );
      expect(authMocks.rpc).not.toHaveBeenCalled();
      expect(response.headers.get("set-cookie") ?? "").not.toContain(
        "localhub-intent=;",
      );
    },
  );

  it("turns a forged demand resume into a safe return without claiming or clearing", async () => {
    const response = await authResume(resumeRequest(validCookie));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost:3000${demandPath}`,
    );
    expect(authMocks.rpc).not.toHaveBeenCalled();
    expect(authMocks.consumeAuthRateLimit).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      "localhub-intent=;",
    );
  });
});
