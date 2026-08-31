import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getSuperAdminTriageAccess,
  listActiveAdminMarkets,
  listSuperAdminPendingBusinesses,
} from "@/lib/admin/business-triage-rpc";

const ids = {
  business: "11111111-1111-4111-8111-111111111111",
  market: "22222222-2222-4222-8222-222222222222",
};
const submittedAt = "2026-08-30T10:00:00.000Z";
const cursorAt = "2026-08-30T09:00:00.000Z";

const rpc = vi.fn();
const limit = vi.fn();
const order = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const from = vi.fn();
const client = { from, rpc } as never;

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

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  select.mockReset();
  eq.mockReset();
  order.mockReset();
  limit.mockReset();
  from.mockReturnValue({ select });
  select.mockReturnValue({ eq });
  eq.mockReturnValue({ order });
  order.mockReturnValue({ limit });
});

describe("super-admin pending-business triage RPC adapter", () => {
  it("requires exact active-profile and super-admin boolean responses", async () => {
    rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    await expect(getSuperAdminTriageAccess(client)).resolves.toEqual({
      allowed: true,
      error: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "is_current_profile_active");
    expect(rpc).toHaveBeenNthCalledWith(2, "has_capability", {
      required: "super_admin",
    });

    rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: "true", error: null });
    const malformed = await getSuperAdminTriageAccess(client);
    expect(malformed.allowed).toBe(false);
    expect(malformed.error).toBeTruthy();
  });

  it("calls only the named read RPC with an exact fixed page limit and keyset args", async () => {
    rpc.mockResolvedValue({ data: [row()], error: null });

    await expect(
      listSuperAdminPendingBusinesses(client, {
        marketId: ids.market,
        cursor: {
          marketId: ids.market,
          submittedAt: cursorAt,
          businessId: ids.business,
        },
        limit: 25,
      }),
    ).resolves.toMatchObject({
      page: { businesses: [{ businessId: ids.business }], hasMore: false },
      error: null,
    });
    expect(rpc).toHaveBeenCalledWith("list_super_admin_pending_businesses", {
      p_market_id: ids.market,
      p_after_submitted_at: cursorAt,
      p_after_business_id: ids.business,
      p_limit: 25,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a homogeneous wrong-market response or a row at/before the incoming cursor", async () => {
    const transplantedCursor = await listSuperAdminPendingBusinesses(client, {
      marketId: ids.market,
      cursor: {
        marketId: "33333333-3333-4333-8333-333333333333",
        submittedAt,
        businessId: ids.business,
      },
      limit: 25,
    });
    expect(transplantedCursor.page).toBeNull();
    expect(transplantedCursor.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValueOnce({
      data: [row({ market_id: "33333333-3333-4333-8333-333333333333" })],
      error: null,
    });
    const wrongMarket = await listSuperAdminPendingBusinesses(client, {
      marketId: ids.market,
      cursor: null,
      limit: 25,
    });
    expect(wrongMarket.page).toBeNull();
    expect(wrongMarket.error).toBeTruthy();

    rpc.mockResolvedValueOnce({ data: [row()], error: null });
    const staleCursor = await listSuperAdminPendingBusinesses(client, {
      marketId: ids.market,
      cursor: {
        marketId: ids.market,
        submittedAt,
        businessId: ids.business,
      },
      limit: 25,
    });
    expect(staleCursor.page).toBeNull();
    expect(staleCursor.error).toBeTruthy();
  });

  it("uses PostgreSQL cursor defaults for an absent cursor and preserves an empty queue", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await expect(
      listSuperAdminPendingBusinesses(client, {
        marketId: ids.market,
        cursor: null,
        limit: 25,
      }),
    ).resolves.toEqual({
      page: { businesses: [], hasMore: false, nextCursor: null },
      error: null,
    });
    expect(rpc).toHaveBeenCalledWith("list_super_admin_pending_businesses", {
      p_market_id: ids.market,
      p_limit: 25,
    });
  });

  it("fails closed on provider errors, malformed arrays, PII fields, or a row beyond the fixed limit", async () => {
    const cases = [
      { data: row(), error: null },
      { data: [row({ phone_e164: "+2348000000000" })], error: null },
      { data: Array.from({ length: 26 }, () => row()), error: null },
      { data: [row()], error: new Error("provider") },
    ];

    for (const response of cases) {
      rpc.mockResolvedValueOnce(response);
      const result = await listSuperAdminPendingBusinesses(client, {
        marketId: ids.market,
        cursor: null,
        limit: 25,
      });
      expect(result.page).toBeNull();
      expect(result.error).toBeTruthy();
    }
  });

  it("loads only a strict bounded active-market DTO through the user client", async () => {
    limit.mockResolvedValue({
      data: [{ id: ids.market, slug: "lafia", name: "Lafia" }],
      error: null,
    });

    await expect(listActiveAdminMarkets(client)).resolves.toEqual({
      markets: [{ id: ids.market, slug: "lafia", name: "Lafia" }],
      error: null,
    });
    expect(from).toHaveBeenCalledWith("markets");
    expect(select).toHaveBeenCalledWith("id,slug,name");
    expect(eq).toHaveBeenCalledWith("is_active", true);
    expect(order).toHaveBeenCalledWith("name", { ascending: true });
    expect(limit).toHaveBeenCalledWith(50);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails the entire active-market list closed on response drift or provider failure", async () => {
    limit.mockResolvedValueOnce({
      data: [
        { id: ids.market, slug: "lafia", name: "Lafia", phone_e164: "+234" },
      ],
      error: null,
    });
    const result = await listActiveAdminMarkets(client);
    expect(result.markets).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});
