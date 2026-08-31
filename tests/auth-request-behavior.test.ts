import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  claimGuestIntent: vi.fn(),
  consumeAuthRateLimit: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({
  getAppOrigin: () => "http://localhost:3000",
  getAppUrl: () => new URL("http://localhost:3000"),
  getPublicSupabaseConfig: () => ({
    anonKey: "test-anon-key",
    url: "https://localhub.supabase.test",
  }),
}));
vi.mock("@/lib/auth/rate-limit", () => ({
  consumeAuthRateLimit: authMocks.consumeAuthRateLimit,
  getAuthRateLimitIdentifier: () => "test-rate-limit-key",
}));
vi.mock("@/lib/supabase/admin", () => ({
  getServerAdminSupabaseClient: () => ({ rpc: authMocks.adminRpc }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      exchangeCodeForSession: authMocks.exchangeCodeForSession,
      getUser: authMocks.getUser,
    },
    rpc: authMocks.claimGuestIntent,
  }),
}));

import { NextRequest } from "next/server";

import * as resumeRoute from "@/app/auth/resume/route";
import { POST as intentPost } from "@/app/auth/intent/route";
import { GET as callbackGet } from "@/app/auth/callback/route";
import {
  GUEST_INTENT_COOKIE,
  serializeGuestIntentCookie,
} from "@/lib/auth/redirects";
import { parseGuestIntentClaim } from "@/lib/requests/guest-claim";

const intentId = "11111111-1111-4111-8111-111111111111";
const intentSecret = "s".repeat(40);

function requestWithForm(
  url: string,
  values: Record<string, string>,
  headers: Record<string, string> = {},
) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "http://localhost:3000",
      ...headers,
    },
    body: new URLSearchParams(values).toString(),
  });
}

function requestWithIntentCookie(url: string) {
  return new NextRequest(url, {
    headers: {
      cookie: `${GUEST_INTENT_COOKIE}=${serializeGuestIntentCookie(intentId, intentSecret)}`,
    },
  });
}

function setCookieHeader(response: Response) {
  return response.headers.get("set-cookie") ?? "";
}

function resetAuthMocks() {
  authMocks.adminRpc.mockReset();
  authMocks.claimGuestIntent.mockReset();
  authMocks.consumeAuthRateLimit.mockReset();
  authMocks.exchangeCodeForSession.mockReset();
  authMocks.getUser.mockReset();
  authMocks.consumeAuthRateLimit.mockResolvedValue("allowed");
  authMocks.exchangeCodeForSession.mockResolvedValue({ error: null });
  authMocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
}

beforeEach(resetAuthMocks);

describe("auth intent route behavior", () => {
  it("sets a valid intent capability cookie with the required options", async () => {
    authMocks.adminRpc.mockResolvedValue({
      data: { id: intentId, secret: intentSecret },
      error: null,
    });

    const response = await intentPost(
      requestWithForm("http://localhost:3000/auth/intent", {
        action: "continue",
        return_to: "/lafia/requests",
        payload: JSON.stringify({ type: "request" }),
      }),
    );

    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/auth");
    expect(setCookieHeader(response)).toMatch(/HttpOnly/i);
    expect(setCookieHeader(response)).toMatch(/SameSite=Lax/i);
    expect(setCookieHeader(response)).toMatch(/Path=\//i);
    expect(setCookieHeader(response)).toMatch(/Max-Age=900/i);
  });

  it.each([
    { id: "not-a-uuid", secret: intentSecret },
    { id: intentId, secret: "short" },
    { id: intentId, secret: 42 },
  ])(
    "returns a generic failure for malformed RPC output: $id/$secret",
    async (record) => {
      authMocks.adminRpc.mockResolvedValue({ data: record, error: null });

      const response = await intentPost(
        requestWithForm("http://localhost:3000/auth/intent", {
          action: "continue",
          return_to: "/lafia/requests",
          payload: JSON.stringify({ type: "request" }),
        }),
      );
      const location = new URL(response.headers.get("location")!);

      expect(response.status).toBe(303);
      expect(location.pathname).toBe("/auth");
      expect(location.searchParams.get("error")).toBe("auth_failed");
      expect(setCookieHeader(response)).not.toMatch(/localhub-intent=/);
    },
  );
});

describe("auth callback and resume capability behavior", () => {
  function callbackRequest() {
    return requestWithIntentCookie(
      "http://localhost:3000/auth/callback?code=oauth-code&next=%2Flafia%2Frequests",
    );
  }

  it("uses canonical DB return_to and only exposes the opaque intent id", async () => {
    authMocks.claimGuestIntent.mockResolvedValue({
      data: {
        kind: "listing_request",
        outcome: "claimed",
        return_to:
          "/lafia/listings/canonical-vendor~canonical-listing/request?from=db",
      },
      error: null,
    });

    const response = await callbackGet(callbackRequest());
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(303);
    expect(location.pathname).toBe(
      "/lafia/listings/canonical-vendor~canonical-listing/request",
    );
    expect(location.searchParams.get("from")).toBe("db");
    expect(location.searchParams.get("intent")).toBe(intentId);
    expect(location.toString()).not.toContain(intentSecret);
    expect(location.searchParams.has("secret")).toBe(false);
    expect(authMocks.claimGuestIntent).toHaveBeenCalledWith(
      "claim_guest_intent",
      { p_intent_id: intentId, p_secret: intentSecret },
    );
  });

  it("resumes a claimed listing order at its exact confirmation route", async () => {
    authMocks.claimGuestIntent.mockResolvedValue({
      data: {
        kind: "listing_order",
        outcome: "claimed",
        return_to: "/lafia/listings/safe-vendor~safe-listing/order",
      },
      error: null,
    });

    const response = await callbackGet(callbackRequest());
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe(
      "/lafia/listings/safe-vendor~safe-listing/order",
    );
    expect(location.searchParams.get("intent")).toBe(intentId);
    expect(location.toString()).not.toContain(intentSecret);
    expect(setCookieHeader(response)).toMatch(/Max-Age=0/i);
  });

  it("keeps the capability cookie available for a transient callback retry", async () => {
    authMocks.claimGuestIntent.mockResolvedValue({
      data: { outcome: "unknown" },
      error: null,
    });

    const response = await callbackGet(callbackRequest());
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe("/auth");
    expect(location.searchParams.get("resume")).toBe("1");
    expect(location.searchParams.get("intent")).toBe(intentId);
    expect(setCookieHeader(response)).not.toMatch(/Max-Age=0/i);
  });

  it.each([
    { data: [] },
    {
      data: [
        { outcome: "claimed", kind: "continue", return_to: "/" },
        { outcome: "claimed", kind: "continue", return_to: "/" },
      ],
    },
  ])(
    "fails closed on malformed claim row cardinality without clearing the capability: %o",
    async ({ data }) => {
      authMocks.claimGuestIntent.mockResolvedValue({ data, error: null });

      const response = await callbackGet(callbackRequest());
      const location = new URL(response.headers.get("location")!);

      expect(location.pathname).toBe("/auth");
      expect(location.searchParams.get("resume")).toBe("1");
      expect(location.searchParams.get("intent")).toBe(intentId);
      expect(setCookieHeader(response)).not.toMatch(/Max-Age=0/i);
    },
  );

  it("clears the capability cookie after a terminal callback result", async () => {
    authMocks.claimGuestIntent.mockResolvedValue({
      data: {
        outcome: "expired",
        return_to: "/lafia/listings/canonical-vendor~canonical-listing/request",
      },
      error: null,
    });

    const response = await callbackGet(callbackRequest());
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe(
      "/lafia/listings/canonical-vendor~canonical-listing",
    );
    expect(location.searchParams.get("request")).toBe("expired");
    expect(setCookieHeader(response)).toMatch(/Max-Age=0/i);
    expect(setCookieHeader(response)).toMatch(/HttpOnly/i);
  });

  it("is POST-only and rejects cross-origin resume requests before claiming", async () => {
    expect("GET" in resumeRoute).toBe(false);

    const request = requestWithForm(
      "http://localhost:3000/auth/resume",
      { intent: intentId, next: "/lafia/requests" },
      { origin: "https://attacker.example" },
    );
    const response = await resumeRoute.POST(request);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Invalid request origin." });
    expect(authMocks.claimGuestIntent).not.toHaveBeenCalled();
  });

  it("clears the capability cookie after a terminal resume result", async () => {
    authMocks.claimGuestIntent.mockResolvedValue({
      data: {
        outcome: "invalid",
        return_to: "/lafia/listings/canonical-vendor~canonical-listing/request",
      },
      error: null,
    });

    const response = await resumeRoute.POST(
      requestWithForm(
        "http://localhost:3000/auth/resume",
        { intent: intentId, next: "/lafia/requests" },
        {
          cookie: `${GUEST_INTENT_COOKIE}=${serializeGuestIntentCookie(intentId, intentSecret)}`,
        },
      ),
    );
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe(
      "/lafia/listings/canonical-vendor~canonical-listing",
    );
    expect(location.searchParams.get("request")).toBe("expired");
    expect(setCookieHeader(response)).toMatch(/Max-Age=0/i);
  });

  it("POST-resumes a listing order without exposing its capability secret", async () => {
    authMocks.claimGuestIntent.mockResolvedValue({
      data: {
        kind: "listing_order",
        outcome: "replayed",
        return_to: "/lafia/listings/safe-vendor~safe-listing/order",
      },
      error: null,
    });

    const response = await resumeRoute.POST(
      requestWithForm(
        "http://localhost:3000/auth/resume",
        {
          intent: intentId,
          next: "/lafia/listings/safe-vendor~safe-listing/order",
        },
        {
          cookie: `${GUEST_INTENT_COOKIE}=${serializeGuestIntentCookie(intentId, intentSecret)}`,
        },
      ),
    );
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe(
      "/lafia/listings/safe-vendor~safe-listing/order",
    );
    expect(location.searchParams.get("intent")).toBe(intentId);
    expect(location.toString()).not.toContain(intentSecret);
    expect(setCookieHeader(response)).toMatch(/Max-Age=0/i);
  });

  it("uses an order-specific recovery query for a terminal order capability", async () => {
    authMocks.claimGuestIntent.mockResolvedValue({
      data: {
        outcome: "expired",
        return_to: "/lafia/listings/safe-vendor~safe-listing/order",
      },
      error: null,
    });

    const response = await callbackGet(callbackRequest());
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/lafia/listings/safe-vendor~safe-listing");
    expect(location.searchParams.get("order")).toBe("expired");
    expect(location.searchParams.has("request")).toBe(false);
  });
});

describe("guest intent claim parsing", () => {
  it.each([
    undefined,
    [],
    [
      { outcome: "claimed", kind: "continue", return_to: "/lafia/requests" },
      { outcome: "claimed", kind: "continue", return_to: "/lafia/requests" },
    ],
    { outcome: "pending", kind: "continue", return_to: "/lafia/requests" },
    { outcome: "claimed", kind: "unexpected", return_to: "/lafia/requests" },
  ])("keeps unknown claim outcomes transient: %o", (value) => {
    expect(parseGuestIntentClaim(value, null)).toEqual({ state: "transient" });
  });

  it("accepts listing_order only for an explicit claimed or replayed outcome", () => {
    expect(
      parseGuestIntentClaim(
        {
          outcome: "claimed",
          kind: "listing_order",
          return_to: "/lafia/listings/safe-vendor~safe-listing/order",
        },
        null,
      ),
    ).toEqual({
      state: "claimed",
      kind: "listing_order",
      returnTo: "/lafia/listings/safe-vendor~safe-listing/order",
    });
  });

  it.each([
    {
      kind: "listing_order",
      return_to: "/lafia/listings/safe-vendor~safe-listing/request",
    },
    {
      kind: "listing_request",
      return_to: "/lafia/listings/safe-vendor~safe-listing/order",
    },
    {
      kind: "listing_order",
      return_to: "/lafia/listings/not-a-canonical-route/order",
    },
  ])(
    "fails closed when $kind does not match canonical return path $return_to",
    ({ kind, return_to }) => {
      expect(
        parseGuestIntentClaim({ outcome: "claimed", kind, return_to }, null),
      ).toEqual({ state: "transient" });
    },
  );
});
