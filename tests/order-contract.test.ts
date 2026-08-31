import { describe, expect, it } from "vitest";

import {
  formatOrderMoney,
  parseListingOrder,
  parseListingOrderIntentCapability,
  parseListingOrderIntentContext,
  parseListingOrderList,
  parseOrderFulfilmentResponse,
  parseOrderPlacementResponse,
  orderFulfilmentIdempotencyKeySchema,
  parseVendorOrderResponse,
  vendorOrderDecisionIdempotencyKeySchema,
} from "@/lib/orders/contract";

const ids = {
  intent: "11111111-1111-4111-8111-111111111111",
  listing: "22222222-2222-4222-8222-222222222222",
  business: "33333333-3333-4333-8333-333333333333",
  market: "44444444-4444-4444-8444-444444444444",
  order: "55555555-5555-4555-8555-555555555555",
};
const timestamp = "2026-08-30T10:00:00.000Z";

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    order_id: ids.order,
    order_number: "LO-260830-0000000001",
    status: "placed",
    created_at: timestamp,
    placed_at: timestamp,
    vendor_decided_at: null,
    business_id: ids.business,
    vendor_name: "Safe vendor",
    market_slug: "lafia",
    listing_id: ids.listing,
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

function intentRow(overrides: Record<string, unknown> = {}) {
  return {
    intent_id: ids.intent,
    listing_id: ids.listing,
    business_id: ids.business,
    market_id: ids.market,
    quantity: 2,
    return_to: "/lafia/listings/safe-vendor~safe-listing/order",
    market_slug: "lafia",
    listing_route: "safe-vendor~safe-listing",
    listing_title: "Safe listing",
    vendor_name: "Safe vendor",
    currency_code: "NGN",
    unit_price_minor: 1_250_000,
    total_minor: 2_500_000,
    claimed_at: timestamp,
    expires_at: "2026-08-30T10:15:00.000Z",
    consumed_at: null,
    order_id: null,
    order_number: null,
    order_status: null,
    order_created_at: null,
    ...overrides,
  };
}

describe("order presentation contracts", () => {
  it("accepts only version 4 vendor-decision idempotency keys", () => {
    expect(
      vendorOrderDecisionIdempotencyKeySchema.safeParse(
        "77777777-7777-4777-8777-777777777777",
      ).success,
    ).toBe(true);
    expect(
      vendorOrderDecisionIdempotencyKeySchema.safeParse(
        "77777777-7777-1777-8777-777777777777",
      ).success,
    ).toBe(false);
    expect(
      orderFulfilmentIdempotencyKeySchema.safeParse(
        "77777777-7777-4777-8777-777777777777",
      ).success,
    ).toBe(true);
  });

  it("formats the full safe-integer minor-unit range without losing a kobo", () => {
    expect(formatOrderMoney(1_250_001, "NGN")).toBe("₦12,500.01");
    expect(formatOrderMoney(Number.MAX_SAFE_INTEGER, "NGN")).toBe(
      "₦90,071,992,547,409.91",
    );
  });

  it("accepts only the exact database capability wire format", () => {
    expect(
      parseListingOrderIntentCapability({
        id: ids.intent,
        secret: "a".repeat(64),
        expires_at: "2026-08-30T10:15:00.000Z",
      }),
    ).toMatchObject({ id: ids.intent, secret: "a".repeat(64) });
    expect(
      parseListingOrderIntentCapability({
        id: ids.intent,
        secret: "s".repeat(40),
        expires_at: "2026-08-30T10:15:00.000Z",
      }),
    ).toBeNull();
  });

  it("accepts only exact positive server-derived item totals", () => {
    expect(parseListingOrder(orderRow())).toMatchObject({
      orderNumber: "LO-260830-0000000001",
      quantity: 2,
      totalMinor: 2_500_000,
    });
    expect(
      parseListingOrder(orderRow({ unit_price_minor: 0, total_minor: 0 })),
    ).toBeNull();
    expect(parseListingOrder(orderRow({ total_minor: 2_499_999 }))).toBeNull();
    expect(
      parseListingOrder(
        orderRow({ unit_price_minor: Number.MAX_SAFE_INTEGER + 1 }),
      ),
    ).toBeNull();
    expect(
      parseListingOrder(
        orderRow({
          status: "confirmed",
          vendor_decided_at: timestamp,
          fulfilment_id: "66666666-6666-4666-8666-666666666666",
          fulfilment_status: "processing",
          fulfilment_started_at: "2026-08-30T10:01:00.000Z",
          fulfilment_updated_at: "2026-08-30T10:01:00.000Z",
        }),
      ),
    ).toMatchObject({
      fulfilment: {
        status: "processing",
        startedAt: "2026-08-30T10:01:00.000Z",
      },
    });
    expect(
      parseListingOrder(
        orderRow({
          status: "confirmed",
          vendor_decided_at: timestamp,
          fulfilment_id: "66666666-6666-4666-8666-666666666666",
          fulfilment_status: "processing",
          fulfilment_started_at: "2026-08-30T09:59:59.000Z",
          fulfilment_updated_at: "2026-08-30T09:59:59.000Z",
        }),
      ),
    ).toBeNull();
    expect(
      parseListingOrder(
        orderRow({
          fulfilment_status: "processing",
        }),
      ),
    ).toBeNull();
    expect(parseListingOrder(orderRow({ quantity: "2" }))).toBeNull();
  });

  it("rejects extra, missing, or malformed list members", () => {
    expect(parseListingOrder({ ...orderRow(), extra: "unsafe" })).toBeNull();
    const missing = orderRow();
    delete (missing as { vendor_name?: string }).vendor_name;
    expect(parseListingOrder(missing)).toBeNull();
    expect(
      parseListingOrderList([orderRow(), orderRow({ order_number: "bad" })]),
    ).toBeNull();
    expect(
      parseListingOrderList(Array.from({ length: 101 }, () => orderRow())),
    ).toBeNull();
    expect(
      parseListingOrder(orderRow({ vendor_name: "\u034f\u034f" })),
    ).toBeNull();
    expect(
      parseListingOrder(orderRow({ listing_title: `A${"b".repeat(160)}` })),
    ).toBeNull();
    expect(
      parseListingOrder(orderRow({ market_slug: "a".repeat(81) })),
    ).toBeNull();
    expect(
      parseListingOrder(orderRow({ listing_title: "\u{10400}" })),
    ).toBeNull();
    expect(
      parseListingOrder(orderRow({ listing_title: `A${"😀".repeat(159)}` })),
    ).not.toBeNull();
    expect(
      parseListingOrder(orderRow({ listing_title: `A${"😀".repeat(160)}` })),
    ).toBeNull();
    expect(parseListingOrder(orderRow({ status: "draft" }))).toBeNull();
    expect(parseListingOrder(orderRow({ status: "fulfilled" }))).toBeNull();
    expect(parseListingOrder(orderRow({ status: "refunded" }))).toBeNull();
    expect(
      parseListingOrder(
        orderRow({ status: "confirmed", vendor_decided_at: null }),
      ),
    ).toBeNull();
    expect(
      parseListingOrder(orderRow({ vendor_decided_at: timestamp })),
    ).toBeNull();
    expect(
      parseListingOrder(
        orderRow({
          status: "confirmed",
          vendor_decided_at: "2026-08-30T09:59:59.000Z",
        }),
      ),
    ).toBeNull();
  });

  it("requires the optional existing-order tuple to be entirely null or complete", () => {
    expect(parseListingOrderIntentContext(intentRow())).toMatchObject({
      id: ids.intent,
      quantity: 2,
    });
    expect(
      parseListingOrderIntentContext(intentRow({ order_id: ids.order })),
    ).toBeNull();
    expect(
      parseListingOrderIntentContext(
        intentRow({
          consumed_at: timestamp,
          order_id: ids.order,
          order_number: "LO-260830-0000000001",
          order_status: "placed",
          order_created_at: timestamp,
        }),
      ),
    ).toMatchObject({ existingOrderId: ids.order });
    expect(
      parseListingOrderIntentContext(intentRow({ consumed_at: timestamp })),
    ).toBeNull();
    expect(
      parseListingOrderIntentContext(
        intentRow({ return_to: "/lafia/listings/other~listing/order" }),
      ),
    ).toBeNull();
  });

  it("accepts complete success rows and null-only terminal rows", () => {
    expect(
      parseOrderPlacementResponse({
        outcome: "created",
        retryable: false,
        ...orderRow(),
      }),
    ).toMatchObject({ outcome: "created", order: { id: ids.order } });

    const nullProjection = Object.fromEntries(
      Object.keys(orderRow()).map((key) => [key, null]),
    );
    expect(
      parseOrderPlacementResponse({
        outcome: "rate_limited",
        retryable: true,
        ...nullProjection,
      }),
    ).toEqual({ outcome: "rate_limited", retryable: true, order: null });
    expect(
      parseOrderPlacementResponse({
        outcome: "invalid",
        retryable: true,
        ...nullProjection,
      }),
    ).toBeNull();
  });

  it("keeps a terminal placement replay consistent with its decision timestamp", () => {
    expect(
      parseOrderPlacementResponse({
        outcome: "replayed",
        retryable: false,
        ...orderRow({
          status: "cancelled",
          vendor_decided_at: timestamp,
        }),
      }),
    ).toMatchObject({
      outcome: "replayed",
      order: { status: "cancelled", vendorDecidedAt: timestamp },
    });
    expect(
      parseOrderPlacementResponse({
        outcome: "replayed",
        retryable: false,
        ...orderRow({ status: "confirmed", vendor_decided_at: null }),
      }),
    ).toBeNull();
  });

  it("fails closed for malformed, partial, and incoherent vendor decisions", () => {
    const transition = {
      outcome: "transitioned",
      retryable: false,
      order_id: ids.order,
      status: "confirmed",
      vendor_decided_at: timestamp,
      updated_at: timestamp,
    };
    expect(parseVendorOrderResponse(transition)).toMatchObject({
      outcome: "transitioned",
      status: "confirmed",
    });
    expect(parseVendorOrderResponse([transition])).toBeNull();
    expect(parseVendorOrderResponse({ ...transition, extra: true })).toBeNull();
    expect(
      parseVendorOrderResponse({ ...transition, vendor_decided_at: null }),
    ).toBeNull();
    expect(
      parseVendorOrderResponse({
        ...transition,
        updated_at: "2026-08-30T10:01:00.000Z",
      }),
    ).toBeNull();
    expect(
      parseVendorOrderResponse({ ...transition, outcome: "not_found" }),
    ).toBeNull();
  });

  it("accepts only complete, equal-timestamp processing responses", () => {
    const response = {
      outcome: "started",
      retryable: false,
      order_id: ids.order,
      order_status: "confirmed",
      fulfilment_id: "66666666-6666-4666-8666-666666666666",
      fulfilment_status: "processing",
      fulfilment_started_at: "2026-08-30T10:01:00.000Z",
      fulfilment_updated_at: "2026-08-30T10:01:00.000Z",
    };
    expect(parseOrderFulfilmentResponse(response)).toMatchObject({
      outcome: "started",
      fulfilmentStatus: "processing",
    });
    expect(
      parseOrderFulfilmentResponse({
        ...response,
        fulfilment_updated_at: "2026-08-30T10:02:00.000Z",
      }),
    ).toBeNull();
    expect(
      parseOrderFulfilmentResponse({
        ...response,
        outcome: "not_found",
      }),
    ).toBeNull();
  });
});
