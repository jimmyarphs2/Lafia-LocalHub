import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { metadata as adminMetadata } from "../app/admin/layout";
import { metadata as authMetadata } from "../app/auth/layout";
import { metadata as vendorMetadata } from "../app/vendor/layout";
import { metadata as accountMetadata } from "../app/[market]/account/layout";
import { metadata as activityMetadata } from "../app/[market]/activity/layout";
import { metadata as demandConfirmationMetadata } from "../app/[market]/demand/confirm/layout";
import { metadata as listingOrderMetadata } from "../app/[market]/listings/[listing]/order/layout";
import { metadata as listingRequestMetadata } from "../app/[market]/listings/[listing]/request/layout";
import { metadata as ordersMetadata } from "../app/[market]/orders/layout";
import { metadata as merchantReferralMetadata } from "../app/[market]/refer/merchant/layout";
import { metadata as requestsMetadata } from "../app/[market]/requests/layout";
import { metadata as searchMetadata } from "../app/[market]/search/layout";
import { metadata as referralDisclosureMetadata } from "../app/[market]/vendor/onboarding/referral/layout";

const noIndexNoFollow = { index: false, follow: false };

const indexingControlGroups = [
  { routes: ["/auth"], metadata: authMetadata },
  { routes: ["/[market]/search"], metadata: searchMetadata },
  {
    routes: ["/[market]/requests", "/[market]/requests/[request]"],
    metadata: requestsMetadata,
  },
  {
    routes: ["/[market]/orders", "/[market]/orders/[order]"],
    metadata: ordersMetadata,
  },
  {
    routes: ["/[market]/listings/[listing]/request"],
    metadata: listingRequestMetadata,
  },
  {
    routes: ["/[market]/listings/[listing]/order"],
    metadata: listingOrderMetadata,
  },
  {
    routes: ["/[market]/demand/confirm"],
    metadata: demandConfirmationMetadata,
  },
  { routes: ["/[market]/activity"], metadata: activityMetadata },
  { routes: ["/[market]/account"], metadata: accountMetadata },
  {
    routes: ["/[market]/refer/merchant"],
    metadata: merchantReferralMetadata,
  },
  {
    routes: ["/[market]/vendor/onboarding/referral"],
    metadata: referralDisclosureMetadata,
  },
  {
    routes: [
      "/vendor",
      "/vendor/onboarding",
      "/vendor/listings",
      "/vendor/media-lab",
      "/vendor/requests",
      "/vendor/orders",
      "/vendor/orders/[order]",
    ],
    metadata: vendorMetadata,
  },
  {
    routes: ["/admin", "/admin/business-reviews"],
    metadata: adminMetadata,
  },
] as const;

describe("sensitive and query-bearing route indexing controls", () => {
  it("covers the exact non-catalog route set", () => {
    expect(indexingControlGroups.flatMap(({ routes }) => routes)).toEqual([
      "/auth",
      "/[market]/search",
      "/[market]/requests",
      "/[market]/requests/[request]",
      "/[market]/orders",
      "/[market]/orders/[order]",
      "/[market]/listings/[listing]/request",
      "/[market]/listings/[listing]/order",
      "/[market]/demand/confirm",
      "/[market]/activity",
      "/[market]/account",
      "/[market]/refer/merchant",
      "/[market]/vendor/onboarding/referral",
      "/vendor",
      "/vendor/onboarding",
      "/vendor/listings",
      "/vendor/media-lab",
      "/vendor/requests",
      "/vendor/orders",
      "/vendor/orders/[order]",
      "/admin",
      "/admin/business-reviews",
    ]);
  });

  it.each(indexingControlGroups)(
    "$routes use noindex, nofollow, and no canonical",
    ({ metadata }) => {
      expect(metadata.robots).toEqual(noIndexNoFollow);
      expect(metadata.alternates).toEqual({ canonical: null });
    },
  );
});
