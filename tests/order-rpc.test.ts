import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createListingOrderFromIntent,
  createListingOrderIntent,
  getCustomerOrder,
  getListingOrderIntent,
  listCustomerOrders,
  respondToListingOrder,
  startListingOrderFulfilment,
} from "@/lib/orders/rpc";

const intentId = "11111111-1111-4111-8111-111111111111";
const orderId = "55555555-5555-4555-8555-555555555555";
const timestamp = "2026-08-30T10:00:00.000Z";
const rpc = vi.fn();
const client = { rpc } as never;

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    order_id: orderId,
    order_number: "LO-260830-0000000001",
    status: "placed",
    created_at: timestamp,
    placed_at: timestamp,
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
    ...overrides,
  };
}

beforeEach(() => rpc.mockReset());

describe("order RPC adapters", () => {
  it("requires an exact singleton capability and uses generated argument names", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: intentId,
          secret: "a".repeat(64),
          expires_at: "2026-08-30T10:15:00.000Z",
        },
      ],
      error: null,
    });
    await expect(
      createListingOrderIntent(client, {
        listingId: "22222222-2222-4222-8222-222222222222",
        quantity: 2,
        rateLimitKey: "rate-key",
      }),
    ).resolves.toMatchObject({ capability: { id: intentId }, error: null });
    expect(rpc).toHaveBeenCalledWith("create_listing_order_intent", {
      p_listing_id: "22222222-2222-4222-8222-222222222222",
      p_quantity: 2,
      p_rate_limit_key: "rate-key",
    });

    rpc.mockResolvedValue({
      data: { id: intentId, secret: "a".repeat(64), expires_at: timestamp },
      error: null,
    });
    const malformed = await createListingOrderIntent(client, {
      listingId: "22222222-2222-4222-8222-222222222222",
      quantity: 2,
      rateLimitKey: "rate-key",
    });
    expect(malformed.capability).toBeNull();
    expect(malformed.error).toBeInstanceOf(Error);

    rpc.mockResolvedValue({
      data: [
        { id: intentId, secret: "a".repeat(64), expires_at: timestamp },
        { id: intentId, secret: "a".repeat(64), expires_at: timestamp },
      ],
      error: null,
    });
    const multirow = await createListingOrderIntent(client, {
      listingId: "22222222-2222-4222-8222-222222222222",
      quantity: 2,
      rateLimitKey: "rate-key",
    });
    expect(multirow.capability).toBeNull();
    expect(multirow.error).toBeInstanceOf(Error);
  });

  it("rejects object-shaped and multirow optional responses", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(
      (await getListingOrderIntent(client, intentId)).error,
    ).toBeInstanceOf(Error);
    rpc.mockResolvedValue({ data: [orderRow(), orderRow()], error: null });
    expect(
      (await getCustomerOrder(client, "lafia", "LO-260830-0000000001")).error,
    ).toBeInstanceOf(Error);
  });

  it("fails an entire list when one order violates the DTO contract", async () => {
    rpc.mockResolvedValue({
      data: [orderRow(), orderRow({ total_minor: 1 })],
      error: null,
    });
    const result = await listCustomerOrders(client, "lafia");
    expect(result.orders).toEqual([]);
    expect(result.error).toBeInstanceOf(Error);
  });

  it("parses exactly one materialization response", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "replayed", retryable: false, ...orderRow() }],
      error: null,
    });
    await expect(
      createListingOrderFromIntent(client, intentId),
    ).resolves.toMatchObject({
      response: {
        outcome: "replayed",
        order: { orderNumber: "LO-260830-0000000001" },
      },
      error: null,
    });
    expect(rpc).toHaveBeenCalledWith("create_listing_order_from_intent", {
      p_intent_id: intentId,
    });
  });

  it("uses exact RPC arguments and rejects plural transition rows", async () => {
    const transition = {
      outcome: "transitioned",
      retryable: false,
      order_id: orderId,
      status: "confirmed",
      vendor_decided_at: timestamp,
      updated_at: timestamp,
    };
    rpc.mockResolvedValue({ data: [transition], error: null });
    await expect(
      respondToListingOrder(client, {
        orderId,
        decision: "confirm",
        idempotencyKey: "77777777-7777-4777-8777-777777777777",
      }),
    ).resolves.toMatchObject({
      response: { outcome: "transitioned", status: "confirmed" },
      error: null,
    });
    expect(rpc).toHaveBeenCalledWith("respond_to_listing_order", {
      p_order_id: orderId,
      p_decision: "confirm",
      p_idempotency_key: "77777777-7777-4777-8777-777777777777",
    });

    rpc.mockResolvedValue({ data: [transition, transition], error: null });
    expect(
      (
        await respondToListingOrder(client, {
          orderId,
          decision: "confirm",
          idempotencyKey: "77777777-7777-4777-8777-777777777777",
        })
      ).error,
    ).toBeInstanceOf(Error);
  });

  it("uses the separate fulfilment RPC and rejects malformed singleton rows", async () => {
    const processing = {
      outcome: "started",
      retryable: false,
      order_id: orderId,
      order_status: "confirmed",
      fulfilment_id: "66666666-6666-4666-8666-666666666666",
      fulfilment_status: "processing",
      fulfilment_started_at: timestamp,
      fulfilment_updated_at: timestamp,
    };
    rpc.mockResolvedValue({ data: [processing], error: null });
    await expect(
      startListingOrderFulfilment(client, {
        orderId,
        idempotencyKey: "77777777-7777-4777-8777-777777777777",
      }),
    ).resolves.toMatchObject({
      response: { outcome: "started", fulfilmentStatus: "processing" },
      error: null,
    });
    expect(rpc).toHaveBeenCalledWith("start_listing_order_fulfilment", {
      p_order_id: orderId,
      p_idempotency_key: "77777777-7777-4777-8777-777777777777",
    });

    rpc.mockResolvedValue({ data: [processing, processing], error: null });
    expect(
      (
        await startListingOrderFulfilment(client, {
          orderId,
          idempotencyKey: "77777777-7777-4777-8777-777777777777",
        })
      ).error,
    ).toBeInstanceOf(Error);
  });
});
