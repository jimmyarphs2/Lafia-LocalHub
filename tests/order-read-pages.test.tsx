import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ListingOrderRecord } from "@/lib/orders/contract";

type OrderDecisionControlProps = {
  initialIdempotencyKey: string;
  orderId: string;
  status?: ListingOrderRecord["status"];
};
type OrderFulfilmentControlProps = {
  fulfilment: ListingOrderRecord["fulfilment"];
  initialIdempotencyKey: string;
  orderId: string;
  status: ListingOrderRecord["status"];
};

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  getCustomerOrder: vi.fn(),
  getVendorOrder: vi.fn(),
  listCustomerOrders: vi.fn(),
  listVendorOrders: vi.fn(),
  notFound: vi.fn(),
  orderDecisionControls: vi.fn((props: OrderDecisionControlProps) => (
    <div data-order-status={props.status}>Order decision controls</div>
  )),
  redirect: vi.fn(),
  orderFulfilmentControls: vi.fn((props: OrderFulfilmentControlProps) => (
    <div data-fulfilment-status={props.fulfilment?.status ?? "none"}>
      Order fulfilment controls
    </div>
  )),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("@/lib/orders/rpc", () => ({
  getCustomerOrder: mocks.getCustomerOrder,
  getVendorOrder: mocks.getVendorOrder,
  listCustomerOrders: mocks.listCustomerOrders,
  listVendorOrders: mocks.listVendorOrders,
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: mocks.getClient,
}));
vi.mock("@/components/vendor/order-decision-controls", () => ({
  OrderDecisionControls: mocks.orderDecisionControls,
}));
vi.mock("@/components/vendor/order-fulfilment-controls", () => ({
  OrderFulfilmentControls: mocks.orderFulfilmentControls,
}));

import CustomerOrderDetailPage from "@/app/[market]/orders/[order]/page";
import CustomerOrdersPage from "@/app/[market]/orders/page";
import VendorOrderDetailPage from "@/app/vendor/orders/[order]/page";
import VendorOrdersPage from "@/app/vendor/orders/page";

const redirectSignal = new Error("NEXT_REDIRECT");
const notFoundSignal = new Error("NEXT_NOT_FOUND");
const order: ListingOrderRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  orderNumber: "LO-260830-0000000001",
  status: "placed",
  createdAt: "2026-08-30T12:00:00.000Z",
  placedAt: "2026-08-30T12:00:00.000Z",
  vendorDecidedAt: null,
  businessId: "22222222-2222-4222-8222-222222222222",
  vendorName: "Lafia Bakes",
  marketSlug: "lafia",
  listingId: "33333333-3333-4333-8333-333333333333",
  listingRoute: "lafia-bakes~birthday-cakes",
  listingTitle: "Birthday cakes",
  quantity: 2,
  currencyCode: "NGN",
  unitPriceMinor: 1_250_000,
  totalMinor: 2_500_000,
  fulfilment: null,
};

function authenticatedClient() {
  return {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: "active-user" } } }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockResolvedValue(authenticatedClient());
  mocks.listCustomerOrders.mockResolvedValue({ orders: [order], error: null });
  mocks.getCustomerOrder.mockResolvedValue({ order, error: null });
  mocks.listVendorOrders.mockResolvedValue({ orders: [order], error: null });
  mocks.getVendorOrder.mockResolvedValue({ order, error: null });
  mocks.redirect.mockImplementation(() => {
    throw redirectSignal;
  });
  mocks.notFound.mockImplementation(() => {
    throw notFoundSignal;
  });
});

describe("customer order read pages", () => {
  it("loads the exact market projection and links by canonical order number", async () => {
    const view = await CustomerOrdersPage({
      params: Promise.resolve({ market: "lafia" }),
    } as never);
    const markup = renderToStaticMarkup(view);

    expect(mocks.listCustomerOrders).toHaveBeenCalledWith(
      expect.anything(),
      "lafia",
    );
    expect(markup).toContain("/lafia/orders/LO-260830-0000000001");
    expect(markup).toContain("Placed — awaiting vendor confirmation");
    expect(markup).toContain("no payment has been collected");
    expect(markup).toContain('dateTime="2026-08-30T12:00:00.000Z"');
    expect(markup).toContain("12:00 UTC");
  });

  it("fails the complete list closed on provider error or market drift", async () => {
    mocks.listCustomerOrders.mockResolvedValueOnce({
      orders: [order],
      error: new Error("provider"),
    });
    const providerView = await CustomerOrdersPage({
      params: Promise.resolve({ market: "lafia" }),
    } as never);
    const providerMarkup = renderToStaticMarkup(providerView);
    expect(providerMarkup).toContain("temporarily unavailable");
    expect(providerMarkup).not.toContain(order.orderNumber);

    mocks.listCustomerOrders.mockResolvedValueOnce({
      orders: [{ ...order, marketSlug: "jos" }],
      error: null,
    });
    const driftView = await CustomerOrdersPage({
      params: Promise.resolve({ market: "lafia" }),
    } as never);
    const driftMarkup = renderToStaticMarkup(driftView);
    expect(driftMarkup).toContain("temporarily unavailable");
    expect(driftMarkup).not.toContain(order.orderNumber);
  });

  it("shows provider failure before not-found and rejects route projection drift", async () => {
    mocks.getCustomerOrder.mockResolvedValueOnce({
      order: null,
      error: new Error("provider"),
    });
    const unavailable = await CustomerOrderDetailPage({
      params: Promise.resolve({
        market: "lafia",
        order: order.orderNumber,
      }),
    } as never);
    expect(renderToStaticMarkup(unavailable)).toContain(
      "Order temporarily unavailable",
    );
    expect(mocks.notFound).not.toHaveBeenCalled();

    mocks.getCustomerOrder.mockResolvedValueOnce({
      order: { ...order, marketSlug: "jos" },
      error: null,
    });
    await expect(
      CustomerOrderDetailPage({
        params: Promise.resolve({
          market: "lafia",
          order: order.orderNumber,
        }),
      } as never),
    ).rejects.toBe(notFoundSignal);
  });

  it("redirects unauthenticated readers without calling a read RPC", async () => {
    mocks.getClient.mockResolvedValueOnce(null);
    await expect(
      CustomerOrdersPage({
        params: Promise.resolve({ market: "lafia" }),
      } as never),
    ).rejects.toBe(redirectSignal);

    expect(mocks.redirect).toHaveBeenCalledWith("/auth?next=%2Flafia%2Forders");
    expect(mocks.listCustomerOrders).not.toHaveBeenCalled();
  });
});

describe("vendor order read pages", () => {
  it("keeps the inbox navigational without customer identity or state controls", async () => {
    const view = await VendorOrdersPage();
    const markup = renderToStaticMarkup(view);

    expect(mocks.listVendorOrders).toHaveBeenCalledWith(expect.anything());
    expect(markup).toContain("Lafia Bakes");
    expect(markup).toContain("awaiting vendor confirmation");
    expect(markup).not.toMatch(/buyer|email|phone|delivery address/i);
    expect(markup).not.toMatch(/confirm order|cancel order|refund order/i);
  });

  it("does not render provider-error rows", async () => {
    mocks.listVendorOrders.mockResolvedValueOnce({
      orders: [order],
      error: new Error("provider"),
    });
    const view = await VendorOrdersPage();
    const markup = renderToStaticMarkup(view);

    expect(markup).toContain("Orders are temporarily unavailable");
    expect(markup).not.toContain(order.orderNumber);
  });

  it("validates the order number before access and surfaces provider failure", async () => {
    await expect(
      VendorOrderDetailPage({
        params: Promise.resolve({ order: "not-an-order" }),
      } as never),
    ).rejects.toBe(notFoundSignal);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.getVendorOrder).not.toHaveBeenCalled();

    mocks.getVendorOrder.mockResolvedValueOnce({
      order: null,
      error: new Error("provider"),
    });
    const unavailable = await VendorOrderDetailPage({
      params: Promise.resolve({ order: order.orderNumber }),
    } as never);
    expect(renderToStaticMarkup(unavailable)).toContain(
      "Order temporarily unavailable",
    );
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });

  it("keeps the terminal decision status control mounted after a refresh", async () => {
    mocks.getVendorOrder.mockResolvedValueOnce({
      order: { ...order, status: "confirmed", vendorDecidedAt: order.placedAt },
      error: null,
    });

    const view = await VendorOrderDetailPage({
      params: Promise.resolve({ order: order.orderNumber }),
    } as never);
    renderToStaticMarkup(view);

    expect(mocks.orderDecisionControls.mock.calls[0]?.[0]).toMatchObject({
      orderId: order.id,
      status: "confirmed",
    });
  });

  it("passes only the canonical confirmed processing state to detail fulfilment controls", async () => {
    const processingOrder = {
      ...order,
      status: "confirmed" as const,
      vendorDecidedAt: order.placedAt,
      fulfilment: {
        id: "77777777-7777-4777-8777-777777777777",
        status: "processing" as const,
        startedAt: order.placedAt,
        updatedAt: order.placedAt,
      },
    };
    mocks.getVendorOrder.mockResolvedValueOnce({
      order: processingOrder,
      error: null,
    });

    const view = await VendorOrderDetailPage({
      params: Promise.resolve({ order: order.orderNumber }),
    } as never);
    renderToStaticMarkup(view);

    expect(mocks.orderFulfilmentControls.mock.calls[0]?.[0]).toMatchObject({
      orderId: order.id,
      status: "confirmed",
      fulfilment: { status: "processing" },
    });
  });
});
