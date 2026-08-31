import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: mocks.getClient,
}));

import { placeListingOrder } from "@/app/[market]/listings/[listing]/order/actions";

const intentId = "11111111-1111-4111-8111-111111111111";
const redirectSignal = new Error("NEXT_REDIRECT");

function formData(values: readonly string[] = [intentId]) {
  const form = new FormData();
  for (const value of values) form.append("intent_id", value);
  return form;
}

function response(outcome: "created" | "replayed" = "created") {
  return {
    outcome,
    retryable: false,
    order_id: "55555555-5555-4555-8555-555555555555",
    order_number: "LO-260830-0000000001",
    status: "placed",
    created_at: "2026-08-30T10:00:00.000Z",
    placed_at: "2026-08-30T10:00:00.000Z",
    vendor_decided_at: null,
    business_id: "33333333-3333-4333-8333-333333333333",
    vendor_name: "Safe vendor",
    market_slug: "lafia",
    listing_id: "22222222-2222-4222-8222-222222222222",
    listing_route: "safe-vendor~safe-listing",
    listing_title: "Safe listing",
    quantity: 2,
    currency_code: "NGN",
    unit_price_minor: 1_250_000,
    total_minor: 2_500_000,
    fulfilment_id: null,
    fulfilment_status: null,
    fulfilment_started_at: null,
    fulfilment_updated_at: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockResolvedValue({
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: "customer" } } }),
    },
    rpc: mocks.rpc,
  });
  mocks.rpc.mockResolvedValue({ data: [response()], error: null });
  mocks.redirect.mockImplementation(() => {
    throw redirectSignal;
  });
});

describe("order placement Server Action", () => {
  it("rejects malformed or duplicate intent values before client access", async () => {
    await expect(
      placeListingOrder(null, formData(["not-a-uuid"])),
    ).resolves.toMatchObject({ code: "validation", retryable: false });
    await expect(
      placeListingOrder(null, formData([intentId, intentId])),
    ).resolves.toMatchObject({ code: "validation", retryable: false });
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed without an authenticated customer", async () => {
    mocks.getClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      rpc: mocks.rpc,
    });
    await expect(placeListingOrder(null, formData())).resolves.toMatchObject({
      code: "unauthorized",
      retryable: false,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["created", "replayed"] as const)(
    "submits only the intent UUID and redirects canonical %s placement",
    async (outcome) => {
      mocks.rpc.mockResolvedValue({ data: [response(outcome)], error: null });
      await expect(placeListingOrder(null, formData())).rejects.toBe(
        redirectSignal,
      );
      expect(mocks.rpc).toHaveBeenCalledWith(
        "create_listing_order_from_intent",
        { p_intent_id: intentId },
      );
      expect(mocks.revalidatePath).toHaveBeenCalledWith(
        "/[market]/orders",
        "page",
      );
      expect(mocks.redirect).toHaveBeenCalledWith(
        "/lafia/orders/LO-260830-0000000001",
      );
    },
  );

  it("preserves the same intent for a retryable provider failure", async () => {
    mocks.rpc.mockRejectedValue(new Error("offline"));
    await expect(placeListingOrder(null, formData())).resolves.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps a quote change to definitive, non-transactional feedback", async () => {
    const nulls = Object.fromEntries(
      Object.keys(response())
        .filter((key) => key !== "outcome" && key !== "retryable")
        .map((key) => [key, null]),
    );
    mocks.rpc.mockResolvedValue({
      data: [{ outcome: "quote_changed", retryable: false, ...nulls }],
      error: null,
    });
    await expect(placeListingOrder(null, formData())).resolves.toMatchObject({
      code: "quote_changed",
      retryable: false,
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
