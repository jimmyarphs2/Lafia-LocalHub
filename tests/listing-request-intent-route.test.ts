import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const routeMocks = vi.hoisted(() => ({
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
  getCatalogForMarket: routeMocks.getCatalogForMarket,
}));
vi.mock("@/lib/supabase/admin", () => ({
  getServerAdminSupabaseClient: () => ({ rpc: routeMocks.adminRpc }),
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: routeMocks.getServerSupabaseClient,
}));

import { NextRequest } from "next/server";

import { POST } from "@/app/[market]/listings/[listing]/request/intent/route";
import {
  FICTIONAL_DEMO_PROVENANCE,
  LIVE_SUPABASE_PROVENANCE,
} from "@/lib/catalog/data";

const intentId = "22222222-2222-4222-8222-222222222222";
const intentSecret = "t".repeat(40);

const market = {
  id: "market-1",
  slug: "lafia",
  name: "Lafia",
  countryCode: "NG",
  currencyCode: "NGN",
  timezone: "Africa/Lagos",
};

function request() {
  return new NextRequest(
    "http://localhost:3000/lafia/listings/vendor~artisan-service/request/intent",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "http://localhost:3000",
      },
      body: new URLSearchParams({
        requested_action: "enquire",
        search_context: "artisan service",
      }).toString(),
    },
  );
}

function snapshot(
  state: "ready" | "unavailable",
  listings: readonly Record<string, unknown>[] = [],
  source: "fictional-demo" | "supabase" = state === "ready"
    ? "fictional-demo"
    : "supabase",
) {
  return {
    state,
    source,
    market,
    categories: [],
    locations: [],
    vendors: [],
    listings,
  };
}

const demoListing = {
  id: "33333333-3333-4333-8333-333333333333",
  marketId: market.id,
  routeKey: "vendor~artisan-service",
  slug: "artisan-service",
  provenance: FICTIONAL_DEMO_PROVENANCE,
};

const liveListing = {
  id: "44444444-4444-4444-8444-444444444444",
  marketId: market.id,
  routeKey: "vendor~artisan-service",
  slug: "artisan-service",
  provenance: LIVE_SUPABASE_PROVENANCE,
};

function setCookieHeader(response: Response) {
  return response.headers.get("set-cookie") ?? "";
}

beforeEach(() => {
  routeMocks.adminRpc.mockReset();
  routeMocks.claimRpc.mockReset();
  routeMocks.getCatalogForMarket.mockReset();
  routeMocks.getServerSupabaseClient.mockReset();
});

describe("listing request intent route", () => {
  it.each([
    ["fictional demo", snapshot("ready", [demoListing])],
    ["unavailable catalog", snapshot("unavailable")],
  ])(
    "returns unavailable without calling an admin RPC for %s",
    async (_label, catalog) => {
      routeMocks.getCatalogForMarket.mockResolvedValue(catalog);

      const response = await POST(request(), {
        params: Promise.resolve({
          market: "lafia",
          listing: "vendor~artisan-service",
        }),
      });
      const location = new URL(response.headers.get("location")!);

      expect(response.status).toBe(303);
      expect(location.pathname).toBe("/lafia/listings/vendor~artisan-service");
      expect(location.searchParams.get("request")).toBe("unavailable");
      expect(routeMocks.adminRpc).not.toHaveBeenCalled();
    },
  );

  it("claims a signed-in live intent and clears its capability cookie", async () => {
    routeMocks.getCatalogForMarket.mockResolvedValue(
      snapshot("ready", [liveListing], "supabase"),
    );
    routeMocks.adminRpc.mockResolvedValue({
      data: { id: intentId, secret: intentSecret },
      error: null,
    });
    routeMocks.getServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      rpc: routeMocks.claimRpc,
    });
    routeMocks.claimRpc.mockResolvedValue({
      data: {
        kind: "listing_request",
        outcome: "claimed",
        return_to: "/lafia/listings/vendor~artisan-service/request",
      },
      error: null,
    });

    const response = await POST(request(), {
      params: Promise.resolve({
        market: "lafia",
        listing: "vendor~artisan-service",
      }),
    });
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(303);
    expect(location.pathname).toBe(
      "/lafia/listings/vendor~artisan-service/request",
    );
    expect(location.searchParams.get("intent")).toBe(intentId);
    expect(routeMocks.adminRpc).toHaveBeenCalledWith(
      "create_listing_request_intent",
      expect.objectContaining({
        p_listing_id: liveListing.id,
        p_requested_action: "enquire",
      }),
    );
    expect(routeMocks.claimRpc).toHaveBeenCalledWith("claim_guest_intent", {
      p_intent_id: intentId,
      p_secret: intentSecret,
    });
    expect(setCookieHeader(response)).toMatch(/Max-Age=0/i);
  });
});
