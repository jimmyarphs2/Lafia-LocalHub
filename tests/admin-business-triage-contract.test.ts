import { describe, expect, it } from "vitest";

import {
  parseActiveAdminMarkets,
  parseBusinessTriageSearchParams,
  parseSuperAdminPendingBusinessPage,
  SUPER_ADMIN_BUSINESS_TRIAGE_MAX_PAGE_SIZE,
  SUPER_ADMIN_BUSINESS_TRIAGE_PAGE_SIZE,
} from "@/lib/admin/business-triage-contract";

const ids = {
  business: "11111111-1111-4111-8111-111111111111",
  market: "22222222-2222-4222-8222-222222222222",
};
const submittedAt = "2026-08-30T10:00:00.000Z";

function row(overrides: Record<string, unknown> = {}) {
  return {
    business_id: ids.business,
    business_name: "Amina's Fresh Produce",
    market_id: ids.market,
    market_slug: "lafia",
    market_name: "Lafia",
    category_slug: "food-catering",
    submitted_at: submittedAt,
    has_more: false,
    ...overrides,
  };
}

describe("admin business triage wire contract", () => {
  it("keeps the application page size fixed while allowing the database maximum", () => {
    expect(SUPER_ADMIN_BUSINESS_TRIAGE_PAGE_SIZE).toBe(25);
    expect(SUPER_ADMIN_BUSINESS_TRIAGE_MAX_PAGE_SIZE).toBe(50);
  });

  it("accepts only the exact PII-minimized pending-business projection", () => {
    expect(parseSuperAdminPendingBusinessPage([row()], 25)).toEqual({
      businesses: [
        {
          businessId: ids.business,
          businessName: "Amina's Fresh Produce",
          marketId: ids.market,
          marketSlug: "lafia",
          marketName: "Lafia",
          categorySlug: "food-catering",
          submittedAt,
        },
      ],
      hasMore: false,
      nextCursor: null,
    });
    expect(
      parseSuperAdminPendingBusinessPage(
        [row({ phone_e164: "+2348000000000" })],
        25,
      ),
    ).toBeNull();
    expect(
      parseSuperAdminPendingBusinessPage(
        [row({ metadata: { email: "private@example.test" } })],
        25,
      ),
    ).toBeNull();
  });

  it("rejects malformed, oversized, mixed-market, and unstable result sets", () => {
    expect(parseSuperAdminPendingBusinessPage({ ...row() }, 25)).toBeNull();
    expect(
      parseSuperAdminPendingBusinessPage([row({ business_id: "bad" })], 25),
    ).toBeNull();
    expect(
      parseSuperAdminPendingBusinessPage(
        [row({ submitted_at: "tomorrow" })],
        25,
      ),
    ).toBeNull();
    expect(
      parseSuperAdminPendingBusinessPage([row({ has_more: "false" })], 25),
    ).toBeNull();
    expect(
      parseSuperAdminPendingBusinessPage(
        [
          row(),
          row({
            business_id: "11111111-1111-4111-8111-111111111112",
            market_id: "33333333-3333-4333-8333-333333333333",
            submitted_at: "2026-08-30T11:00:00.000Z",
          }),
        ],
        25,
      ),
    ).toBeNull();
    expect(
      parseSuperAdminPendingBusinessPage(
        Array.from({ length: 26 }, (_, index) =>
          row({
            business_id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
          }),
        ),
        25,
      ),
    ).toBeNull();
    expect(parseSuperAdminPendingBusinessPage([row(), row()], 25)).toBeNull();
    expect(
      parseSuperAdminPendingBusinessPage(
        [
          row({
            business_id: "11111111-1111-4111-8111-111111111112",
            submitted_at: "2026-08-30T11:00:00.000Z",
          }),
          row(),
        ],
        25,
      ),
    ).toBeNull();
  });

  it("requires the has-more bit to be consistent and derives a cursor from the last visible row", () => {
    const page = parseSuperAdminPendingBusinessPage(
      [
        row({
          business_id: "11111111-1111-4111-8111-111111111111",
          has_more: true,
        }),
        row({
          business_id: "11111111-1111-4111-8111-111111111112",
          has_more: true,
        }),
      ],
      2,
    );
    expect(page).toMatchObject({
      hasMore: true,
      nextCursor: {
        marketId: ids.market,
        submittedAt,
        businessId: "11111111-1111-4111-8111-111111111112",
      },
    });
    expect(
      parseSuperAdminPendingBusinessPage(
        [
          row({ has_more: true }),
          row({ business_id: "11111111-1111-4111-8111-111111111112" }),
        ],
        2,
      ),
    ).toBeNull();
    expect(parseSuperAdminPendingBusinessPage([], 25)).toEqual({
      businesses: [],
      hasMore: false,
      nextCursor: null,
    });
  });

  it("preserves PostgreSQL sub-millisecond ordering instead of collapsing it to milliseconds", () => {
    const earlier = row({ submitted_at: "2026-08-30T10:00:00.000001Z" });
    const later = row({
      business_id: "11111111-1111-4111-8111-111111111110",
      submitted_at: "2026-08-30T10:00:00.000002Z",
    });

    expect(
      parseSuperAdminPendingBusinessPage([earlier, later], 25),
    ).not.toBeNull();
    expect(parseSuperAdminPendingBusinessPage([later, earlier], 25)).toBeNull();
  });

  it("accepts only an active public-market projection and caps it", () => {
    expect(
      parseActiveAdminMarkets([
        { id: ids.market, slug: "lafia", name: "Lafia" },
      ]),
    ).toEqual([{ id: ids.market, slug: "lafia", name: "Lafia" }]);
    expect(
      parseActiveAdminMarkets([
        { id: ids.market, slug: "lafia", name: "Lafia", is_active: true },
      ]),
    ).toBeNull();
    expect(
      parseActiveAdminMarkets(
        Array.from({ length: 51 }, () => ({
          id: ids.market,
          slug: "lafia",
          name: "Lafia",
        })),
      ),
    ).toBeNull();
  });

  it("requires a valid market slug and complete keyset cursor search pair", () => {
    expect(parseBusinessTriageSearchParams({ market: "lafia" })).toEqual({
      marketSlug: "lafia",
      cursor: null,
    });
    expect(
      parseBusinessTriageSearchParams({
        market: "lafia",
        afterMarketId: ids.market,
        afterSubmittedAt: submittedAt,
        afterBusinessId: ids.business,
      }),
    ).toEqual({
      marketSlug: "lafia",
      cursor: {
        marketId: ids.market,
        submittedAt,
        businessId: ids.business,
      },
    });
    for (const value of [
      { market: "Lafia" },
      { market: "lafia", afterSubmittedAt: submittedAt },
      { market: "lafia", afterBusinessId: ids.business },
      { market: "lafia", afterMarketId: ids.market },
      {
        market: "lafia",
        afterMarketId: ids.market,
        afterSubmittedAt: "not-a-time",
        afterBusinessId: ids.business,
      },
      {
        market: "lafia",
        afterMarketId: ids.market,
        afterSubmittedAt: submittedAt,
        afterBusinessId: "bad",
      },
      { market: ["lafia", "jos"] },
    ]) {
      expect(parseBusinessTriageSearchParams(value)).toBeNull();
    }
    expect(parseBusinessTriageSearchParams({})).toEqual({
      marketSlug: null,
      cursor: null,
    });
  });
});
