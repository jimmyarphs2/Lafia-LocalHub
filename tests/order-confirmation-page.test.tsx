import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  getIntent: vi.fn(),
  placementForm: vi.fn(
    ({ intentId }: { intentId: string }) => `placement:${intentId}`,
  ),
  redirect: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: mocks.getClient,
}));
vi.mock("@/lib/orders/rpc", () => ({
  getListingOrderIntent: mocks.getIntent,
}));
vi.mock("@/components/order-placement-form", () => ({
  OrderPlacementForm: mocks.placementForm,
}));

import ListingOrderConfirmationPage from "@/app/[market]/listings/[listing]/order/page";

const intentId = "11111111-1111-4111-8111-111111111111";
const redirectSignal = new Error("NEXT_REDIRECT");

function props(
  overrides: { market?: string; listing?: string; intent?: string } = {},
) {
  return {
    params: Promise.resolve({
      market: overrides.market ?? "lafia",
      listing: overrides.listing ?? "safe-vendor~safe-listing",
    }),
    searchParams: Promise.resolve({ intent: overrides.intent ?? intentId }),
  };
}

function intentContext(overrides: Record<string, unknown> = {}) {
  return {
    id: intentId,
    listingId: "22222222-2222-4222-8222-222222222222",
    businessId: "33333333-3333-4333-8333-333333333333",
    marketId: "44444444-4444-4444-8444-444444444444",
    quantity: 2,
    returnTo: "/lafia/listings/safe-vendor~safe-listing/order",
    marketSlug: "lafia",
    listingRoute: "safe-vendor~safe-listing",
    listingTitle: "Safe listing",
    vendorName: "Safe vendor",
    currencyCode: "NGN",
    unitPriceMinor: 1_250_000,
    totalMinor: 2_500_000,
    claimedAt: "2026-08-30T10:00:00.000Z",
    expiresAt: "2026-08-30T10:15:00.000Z",
    consumedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => {
    throw redirectSignal;
  });
  mocks.getClient.mockResolvedValue({
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: "customer" } } }),
    },
  });
  mocks.getIntent.mockResolvedValue({
    context: intentContext(),
    error: null,
  });
});

describe("listing order confirmation page", () => {
  it("renders the server-authoritative quote and only hands the opaque intent to placement", async () => {
    const markup = renderToStaticMarkup(
      await ListingOrderConfirmationPage(props()),
    );

    expect(markup).toContain("Safe listing");
    expect(markup).toContain("Safe vendor");
    expect(markup).toContain("₦25,000.00");
    expect(markup).toContain("No payment has been collected");
    expect(mocks.placementForm).toHaveBeenCalledWith({ intentId }, undefined);
    expect(markup).not.toContain("secret");
  });

  it("fails closed on provider errors and mismatched RPC context", async () => {
    mocks.getIntent.mockRejectedValueOnce(new Error("offline"));
    await expect(ListingOrderConfirmationPage(props())).rejects.toBe(
      redirectSignal,
    );
    expect(mocks.redirect).toHaveBeenLastCalledWith(
      "/lafia/listings/safe-vendor~safe-listing?order=unavailable",
    );

    mocks.getIntent.mockResolvedValueOnce({
      context: intentContext({
        id: "99999999-9999-4999-8999-999999999999",
      }),
      error: null,
    });
    await expect(ListingOrderConfirmationPage(props())).rejects.toBe(
      redirectSignal,
    );
    expect(mocks.redirect).toHaveBeenLastCalledWith(
      "/lafia/listings/safe-vendor~safe-listing?order=unavailable",
    );
  });

  it("redirects an already materialized intent to the canonical customer receipt", async () => {
    mocks.getIntent.mockResolvedValue({
      context: intentContext({
        consumedAt: "2026-08-30T10:05:00.000Z",
        existingOrderId: "55555555-5555-4555-8555-555555555555",
        existingOrderNumber: "LO-260830-0000000001",
        existingOrderStatus: "placed",
        existingOrderCreatedAt: "2026-08-30T10:05:00.000Z",
      }),
      error: null,
    });

    await expect(ListingOrderConfirmationPage(props())).rejects.toBe(
      redirectSignal,
    );
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/lafia/orders/LO-260830-0000000001",
    );
  });

  it("keeps a valid opaque continuation when server auth construction is transiently unavailable", async () => {
    mocks.getClient.mockRejectedValue(new Error("cookies unavailable"));

    await expect(ListingOrderConfirmationPage(props())).rejects.toBe(
      redirectSignal,
    );
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/auth?next=${encodeURIComponent(
        `/lafia/listings/safe-vendor~safe-listing/order?intent=${intentId}`,
      )}`,
    );
  });
});
