import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  claimRpc: vi.fn(),
  getCatalogForMarket: vi.fn(),
  getServerSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({
  getAppOrigin: () => "http://localhost:3000",
  getAppUrl: () => new URL("http://localhost:3000"),
}));
vi.mock("@/lib/auth/rate-limit", () => ({
  getAuthRateLimitIdentifier: () => "test-rate-limit-key",
}));
vi.mock("@/lib/catalog/source", () => ({
  getCatalogForMarket: mocks.getCatalogForMarket,
}));
vi.mock("@/lib/supabase/admin", () => ({
  getServerAdminSupabaseClient: () => ({ rpc: mocks.adminRpc }),
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: mocks.getServerSupabaseClient,
}));

import { NextRequest } from "next/server";

import * as orderIntentRoute from "@/app/[market]/listings/[listing]/order/intent/route";
import {
  FICTIONAL_DEMO_PROVENANCE,
  LIVE_SUPABASE_PROVENANCE,
} from "@/lib/catalog/data";

const intentId = "11111111-1111-4111-8111-111111111111";
const secret = "a".repeat(64);
const listingId = "22222222-2222-4222-8222-222222222222";
const marketId = "44444444-4444-4444-8444-444444444444";

function request(
  body: URLSearchParams | string = new URLSearchParams({ quantity: "2" }),
  origin = "http://localhost:3000",
  contentType = "application/x-www-form-urlencoded",
) {
  return new NextRequest(
    "http://localhost:3000/lafia/listings/safe-vendor~safe-listing/order/intent",
    {
      method: "POST",
      headers: {
        "content-type": contentType,
        origin,
      },
      body: body.toString(),
    },
  );
}

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: listingId,
    marketId,
    routeKey: "safe-vendor~safe-listing",
    slug: "safe-listing",
    isOrderable: true,
    priceMinor: 1_250_000,
    currencyCode: "NGN",
    provenance: LIVE_SUPABASE_PROVENANCE,
    ...overrides,
  };
}

function catalog(item: Record<string, unknown>) {
  return {
    state: "ready",
    source: "supabase",
    market: { id: marketId, slug: "lafia" },
    listings: [item],
    categories: [],
    locations: [],
    vendors: [],
  };
}

function context() {
  return {
    params: Promise.resolve({
      market: "lafia",
      listing: "safe-vendor~safe-listing",
    }),
  };
}

function cookie(response: Response) {
  return response.headers.get("set-cookie") ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCatalogForMarket.mockResolvedValue(catalog(listing()));
  mocks.adminRpc.mockResolvedValue({
    data: [
      {
        id: intentId,
        secret,
        expires_at: "2026-08-30T10:15:00.000Z",
      },
    ],
    error: null,
  });
  mocks.getServerSupabaseClient.mockResolvedValue(null);
});

describe("listing order intent route", () => {
  it("exports only POST and rejects cross-origin requests before mutation", async () => {
    expect("GET" in orderIntentRoute).toBe(false);
    const response = await orderIntentRoute.POST(
      request(undefined, "https://attacker.example"),
      context(),
    );
    expect(response.status).toBe(403);
    expect(mocks.getCatalogForMarket).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("rejects non-form and oversized bodies before privileged RPC work", async () => {
    const wrongContentType = await orderIntentRoute.POST(
      request("quantity=2", undefined, "text/plain"),
      context(),
    );
    expect(wrongContentType.status).toBe(303);

    const oversizedResponse = await orderIntentRoute.POST(
      request(
        new URLSearchParams({
          quantity: "2",
          padding: "x".repeat(4 * 1024),
        }),
      ),
      context(),
    );
    expect(oversizedResponse.status).toBe(303);
    expect(mocks.getCatalogForMarket).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it.each([
    ["fictional demo", listing({ provenance: FICTIONAL_DEMO_PROVENANCE })],
    ["non-orderable", listing({ isOrderable: false })],
    ["unpriced", listing({ priceMinor: undefined })],
    ["zero-priced", listing({ priceMinor: 0 })],
  ])(
    "rejects a %s listing before privileged RPC work",
    async (_label, item) => {
      mocks.getCatalogForMarket.mockResolvedValue(catalog(item));
      const response = await orderIntentRoute.POST(request(), context());
      const location = new URL(response.headers.get("location")!);
      expect(response.status).toBe(303);
      expect(location.pathname).toBe(
        "/lafia/listings/safe-vendor~safe-listing",
      );
      expect(location.searchParams.get("order")).toBe("unavailable");
      expect(mocks.adminRpc).not.toHaveBeenCalled();
    },
  );

  it("rejects duplicate, non-canonical, or out-of-range quantity without creating an intent", async () => {
    const duplicate = new URLSearchParams();
    duplicate.append("quantity", "1");
    duplicate.append("quantity", "2");
    await orderIntentRoute.POST(request(duplicate), context());
    expect(mocks.adminRpc).not.toHaveBeenCalled();

    await orderIntentRoute.POST(
      request(new URLSearchParams({ quantity: "101" })),
      context(),
    );
    expect(mocks.adminRpc).not.toHaveBeenCalled();

    for (const quantity of ["2e0", "0x2", "02", " 2", "2 "]) {
      await orderIntentRoute.POST(
        request(new URLSearchParams({ quantity })),
        context(),
      );
    }
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("sets a secret-free capability cookie and resumes through auth", async () => {
    const response = await orderIntentRoute.POST(request(), context());
    const location = new URL(response.headers.get("location")!);
    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/auth");
    expect(location.toString()).not.toContain(secret);
    expect(cookie(response)).toMatch(/HttpOnly/i);
    expect(cookie(response)).toMatch(/SameSite=Lax/i);
    expect(cookie(response)).toMatch(/Path=\//i);
    expect(cookie(response)).toMatch(/Max-Age=900/i);
    expect(mocks.adminRpc).toHaveBeenCalledWith("create_listing_order_intent", {
      p_listing_id: listingId,
      p_quantity: 2,
      p_rate_limit_key: "test-rate-limit-key",
    });
  });

  it("preserves the capability cookie when server auth-client construction fails", async () => {
    mocks.getServerSupabaseClient.mockRejectedValue(
      new Error("temporary auth provider failure"),
    );

    const response = await orderIntentRoute.POST(request(), context());
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/auth");
    expect(location.searchParams.get("next")).toBe(
      `/lafia/listings/safe-vendor~safe-listing/order?intent=${intentId}`,
    );
    expect(cookie(response)).toMatch(/HttpOnly/i);
    expect(cookie(response)).toMatch(/Max-Age=900/i);
    expect(cookie(response)).not.toMatch(/Max-Age=0/i);
    expect(location.toString()).not.toContain(secret);
  });

  it("claims immediately for a signed-in customer and clears the capability", async () => {
    mocks.getServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: "customer" } } }),
      },
      rpc: mocks.claimRpc,
    });
    mocks.claimRpc.mockResolvedValue({
      data: {
        outcome: "claimed",
        kind: "listing_order",
        return_to: "/lafia/listings/safe-vendor~safe-listing/order",
      },
      error: null,
    });

    const response = await orderIntentRoute.POST(request(), context());
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe(
      "/lafia/listings/safe-vendor~safe-listing/order",
    );
    expect(location.searchParams.get("intent")).toBe(intentId);
    expect(cookie(response)).toMatch(/Max-Age=0/i);
    expect(mocks.claimRpc).toHaveBeenCalledWith("claim_guest_intent", {
      p_intent_id: intentId,
      p_secret: secret,
    });
  });

  it.each([
    {
      label: "object-shaped",
      data: { id: intentId, secret, expires_at: "2026-08-30T10:15:00.000Z" },
    },
    {
      label: "multi-row",
      data: [
        { id: intentId, secret, expires_at: "2026-08-30T10:15:00.000Z" },
        { id: intentId, secret, expires_at: "2026-08-30T10:15:00.000Z" },
      ],
    },
  ])(
    "rejects $label capability output without setting a cookie",
    async ({ data }) => {
      mocks.adminRpc.mockResolvedValue({ data, error: null });
      const response = await orderIntentRoute.POST(request(), context());
      expect(
        new URL(response.headers.get("location")!).searchParams.get("order"),
      ).toBe("unavailable");
      expect(cookie(response)).toBe("");
    },
  );
});
