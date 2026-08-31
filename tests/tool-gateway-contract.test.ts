import { describe, expect, it } from "vitest";

import {
  parsePlatformSummaryRpcResult,
  platformSummaryRequestSchema,
} from "@/lib/tools/contract";

const invocationId = "9b25ec57-65d3-48bc-bcfa-92ac7f44eb2f";
const auditEventId = "93237679-dc05-409e-a38d-bab465c94ac4";
const marketId = "0677df4f-65f2-41e9-aa01-27bb70788358";

function successRow() {
  return {
    invocation_id: invocationId,
    audit_event_id: auditEventId,
    outcome: "succeeded",
    observed_at: "2026-08-31T12:00:00.000Z",
    market_id: marketId,
    market_slug: "lafia",
    market_name: "Lafia",
    country_code: "NG",
    currency_code: "NGN",
    timezone: "Africa/Lagos",
    active_category_count: 4,
    active_vendor_count: 3,
    published_listing_count: 7,
    orderable_listing_count: 2,
  };
}

describe("tool-gateway contracts", () => {
  it("accepts only the exact implemented request and canonical market slug", () => {
    expect(
      platformSummaryRequestSchema.safeParse({
        contractVersion: 1,
        tool: "get_platform_summary",
        input: { marketSlug: "lafia" },
      }).success,
    ).toBe(true);

    for (const request of [
      null,
      [],
      {
        contractVersion: 1,
        tool: "get_platform_summary",
        input: { marketSlug: "Lafia" },
      },
      {
        contractVersion: 1,
        tool: "get_platform_summary",
        input: { marketSlug: "//attacker" },
      },
      {
        contractVersion: 1,
        tool: "get_platform_summary",
        input: { marketSlug: "lafia", actorId: invocationId },
      },
      {
        contractVersion: 1,
        tool: "get_revenue_report",
        input: { marketSlug: "lafia" },
      },
      {
        contractVersion: 1,
        tool: "get_platform_summary",
        input: { marketSlug: "lafia" },
        invocationId,
      },
      {
        contractVersion: 2,
        tool: "get_platform_summary",
        input: { marketSlug: "lafia" },
      },
    ]) {
      expect(platformSummaryRequestSchema.safeParse(request).success).toBe(
        false,
      );
    }
  });

  it("parses one exact success row and requires canonical audit evidence", () => {
    expect(
      parsePlatformSummaryRpcResult([successRow()], {
        invocationId,
        marketSlug: "lafia",
      }),
    ).toEqual({
      outcome: "succeeded",
      invocationId,
      auditEventId,
      observedAt: "2026-08-31T12:00:00.000Z",
      data: {
        market: {
          id: marketId,
          slug: "lafia",
          name: "Lafia",
          countryCode: "NG",
          currencyCode: "NGN",
          timezone: "Africa/Lagos",
        },
        activeCategoryCount: 4,
        activeVendorCount: 3,
        publishedListingCount: 7,
        orderableListingCount: 2,
      },
    });

    for (const value of [
      [],
      [successRow(), successRow()],
      [{ ...successRow(), invocation_id: auditEventId }],
      [{ ...successRow(), audit_event_id: null }],
      [{ ...successRow(), market_slug: "keffi" }],
      [{ ...successRow(), active_vendor_count: "3" }],
      [{ ...successRow(), email: "private@example.com" }],
    ]) {
      expect(
        parsePlatformSummaryRpcResult(value, {
          invocationId,
          marketSlug: "lafia",
        }),
      ).toBeNull();
    }
  });

  it("accepts only null data fields for bounded non-success outcomes", () => {
    const empty = {
      ...successRow(),
      market_id: null,
      market_slug: null,
      market_name: null,
      country_code: null,
      currency_code: null,
      timezone: null,
      active_category_count: null,
      active_vendor_count: null,
      published_listing_count: null,
      orderable_listing_count: null,
    };

    expect(
      parsePlatformSummaryRpcResult(
        [{ ...empty, outcome: "market_not_found" }],
        { invocationId, marketSlug: "lafia" },
      ),
    ).toEqual({
      outcome: "market_not_found",
      invocationId,
      auditEventId,
      observedAt: "2026-08-31T12:00:00.000Z",
    });
    expect(
      parsePlatformSummaryRpcResult(
        [{ ...empty, outcome: "rate_limited", audit_event_id: null }],
        { invocationId, marketSlug: "lafia" },
      ),
    ).toEqual({
      outcome: "rate_limited",
      invocationId,
      auditEventId: null,
      observedAt: "2026-08-31T12:00:00.000Z",
    });

    for (const row of [
      { ...empty, outcome: "garbage" },
      { ...empty, outcome: "market_not_found", audit_event_id: null },
      { ...empty, outcome: "rate_limited", market_name: "oracle" },
      { ...empty, outcome: "invalid_input", market_slug: "raw-input" },
    ]) {
      expect(
        parsePlatformSummaryRpcResult([row], {
          invocationId,
          marketSlug: "lafia",
        }),
      ).toBeNull();
    }
  });
});
