import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  OrderRecordDetail,
  OrderRecordListItem,
} from "@/components/orders/order-record";
import type { ListingOrderRecord } from "@/lib/orders/contract";

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

describe("order presentation", () => {
  it("presents the customer projection with truthful status and amount copy", () => {
    const markup = renderToStaticMarkup(
      <OrderRecordListItem
        href="/lafia/orders/LO-260830-0000000001"
        order={order}
        showVendorName
      />,
    );

    expect(markup).toContain("Placed — awaiting vendor confirmation");
    expect(markup).toContain("no payment has been collected");
    expect(markup).toContain("Lafia Bakes");
    expect(markup).toContain("LO-260830-0000000001");
    expect(markup).toContain("₦12,500.00");
    expect(markup).toContain("₦25,000.00");
  });

  it("keeps vendor presentation free of buyer identity", () => {
    const adversarialOrder = {
      ...order,
      buyerName: "Private Buyer",
      customerEmail: "private@example.com",
      customerPhone: "+2348000000000",
    } as ListingOrderRecord;
    const markup = renderToStaticMarkup(
      <OrderRecordDetail
        headingId="vendor-order"
        order={adversarialOrder}
        showVendorName
      />,
    );

    expect(markup).toContain('aria-labelledby="vendor-order"');
    expect(markup).toContain('aria-label="Order status"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("<dl>");
    expect(markup).toContain('<time dateTime="2026-08-30T12:00:00.000Z">');
    expect(markup).toContain("12:00 UTC");
    expect(markup).toContain("No payment has been collected");
    expect(markup).toContain("Lafia Bakes");
    expect(markup).not.toMatch(/customer|buyer|email|phone/i);
    expect(markup).not.toContain("private@example.com");
    expect(markup).not.toContain("+2348000000000");
  });

  it("presents confirmed processing without a delivery, payment, or completion claim", () => {
    const markup = renderToStaticMarkup(
      <OrderRecordDetail
        headingId="processing-order"
        order={{
          ...order,
          status: "confirmed",
          vendorDecidedAt: order.placedAt,
          fulfilment: {
            id: "44444444-4444-4444-8444-444444444444",
            status: "processing",
            startedAt: "2026-08-30T12:01:00.000Z",
            updatedAt: "2026-08-30T12:01:00.000Z",
          },
        }}
        showVendorName
      />,
    );

    expect(markup).toContain("Vendor is processing your order");
    expect(markup).toContain("begun handling it");
    expect(markup).toContain("Pickup, delivery, handoff, and completion");
    expect(markup).not.toMatch(
      /shipped|out for delivery|ready|delivered|fulfilled/i,
    );
  });
});

describe("order history route boundaries", () => {
  const listingPage = readFileSync(
    resolve(process.cwd(), "app/[market]/listings/[listing]/page.tsx"),
    "utf8",
  );
  const listingProfile = readFileSync(
    resolve(process.cwd(), "components/listing-profile-experience.tsx"),
    "utf8",
  );
  const customerList = readFileSync(
    resolve(process.cwd(), "app/[market]/orders/page.tsx"),
    "utf8",
  );
  const customerDetail = readFileSync(
    resolve(process.cwd(), "app/[market]/orders/[order]/page.tsx"),
    "utf8",
  );
  const vendorList = readFileSync(
    resolve(process.cwd(), "app/vendor/orders/page.tsx"),
    "utf8",
  );
  const vendorDetail = readFileSync(
    resolve(process.cwd(), "app/vendor/orders/[order]/page.tsx"),
    "utf8",
  );
  const marketShell = readFileSync(
    resolve(process.cwd(), "components/market-shell.tsx"),
    "utf8",
  );

  it("gates direct ordering to live orderable listings without removing requests", () => {
    expect(listingPage).toContain(
      "!isFictionalDemo && listing.isOrderable === true",
    );
    expect(listingProfile).toContain("<OrderIntentForm");
    expect(listingProfile).toContain("<CommitmentLink");
    expect(listingPage).toContain('query.order === "expired"');
    expect(listingPage).toContain('query.order === "unavailable"');
  });

  it("keeps reads dynamic, scoped, and linked by canonical order number", () => {
    expect(customerList).toContain('dynamic = "force-dynamic"');
    expect(customerList).toContain("listCustomerOrders(client, market)");
    expect(customerList).toContain("order.marketSlug !== market");
    expect(customerList).toContain("order.orderNumber");
    expect(customerDetail).toContain("orderNumberSchema.safeParse");
    expect(customerDetail).toContain(
      "getCustomerOrder(client, market, orderNumber)",
    );
    expect(customerDetail.indexOf("if (result.error)")).toBeLessThan(
      customerDetail.indexOf("!result.order"),
    );
  });

  it("keeps decisions off the vendor inbox and out of customer projections", () => {
    expect(vendorList).toContain('dynamic = "force-dynamic"');
    expect(vendorList).toContain("listVendorOrders(client)");
    expect(vendorDetail).toContain("getVendorOrder(client, orderNumber)");
    expect(vendorDetail.indexOf("if (result.error)")).toBeLessThan(
      vendorDetail.indexOf("if (!result.order"),
    );
    expect(vendorList + vendorDetail).not.toMatch(
      /customer(Name|Email|Phone)|buyer(Name|Email|Phone)|deliveryAddress/,
    );
    expect(vendorList).not.toContain("OrderDecisionControls");
    expect(vendorDetail).toContain("OrderDecisionControls");
    expect(vendorList).not.toContain("OrderFulfilmentControls");
    expect(vendorDetail).toContain("OrderFulfilmentControls");
    expect(vendorDetail).toContain("status={result.order.status}");
  });

  it("keeps five mobile destinations while routing history through Activity", () => {
    const mobileNav = marketShell.slice(
      marketShell.indexOf("function MobileCustomerNav"),
    );

    expect(mobileNav.match(/<Link/g)).toHaveLength(5);
    expect(mobileNav).not.toContain("AccountIntentButton");
    expect(mobileNav).toContain("/activity");
    expect(mobileNav).toContain("<span>Activity</span>");
    expect(mobileNav).toContain('identity ? "Profile" : "Sign in"');
    expect(mobileNav).toContain("/account");
  });
});
