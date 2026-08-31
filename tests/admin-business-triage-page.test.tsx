import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  capability: vi.fn(),
  getAccess: vi.fn(),
  getClient: vi.fn(),
  getUser: vi.fn(),
  listMarkets: vi.fn(),
  listQueue: vi.fn(),
  notFound: vi.fn(),
  queue: vi.fn(() => <div>Read-only queue</div>),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: mocks.getClient,
}));
vi.mock("@/lib/admin/business-triage-rpc", () => ({
  getSuperAdminTriageAccess: mocks.getAccess,
  listActiveAdminMarkets: mocks.listMarkets,
  listSuperAdminPendingBusinesses: mocks.listQueue,
}));
vi.mock("@/components/admin/business-triage-queue", () => ({
  BusinessTriageQueue: mocks.queue,
}));

import BusinessReviewsPage from "@/app/admin/business-reviews/page";

const redirectSignal = new Error("NEXT_REDIRECT");
const notFoundSignal = new Error("NEXT_NOT_FOUND");
const ids = {
  business: "11111111-1111-4111-8111-111111111111",
  market: "22222222-2222-4222-8222-222222222222",
};
const submittedAt = "2026-08-30T10:00:00.000Z";

function page(searchParams: Record<string, string | string[] | undefined>) {
  return BusinessReviewsPage({
    searchParams: Promise.resolve(searchParams),
  } as never);
}

function userClient() {
  return {
    auth: { getUser: mocks.getUser },
    rpc: vi.fn((name: string) => {
      if (name === "is_current_profile_active") return mocks.active();
      if (name === "has_capability") return mocks.capability();
      throw new Error(`unexpected rpc ${name}`);
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "super-admin" } },
    error: null,
  });
  mocks.active.mockResolvedValue({ data: true, error: null });
  mocks.capability.mockResolvedValue({ data: true, error: null });
  mocks.getClient.mockResolvedValue(userClient());
  mocks.getAccess.mockResolvedValue({ allowed: true, error: null });
  mocks.listMarkets.mockResolvedValue({
    markets: [{ id: ids.market, slug: "lafia", name: "Lafia" }],
    error: null,
  });
  mocks.listQueue.mockResolvedValue({
    page: {
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
    },
    error: null,
  });
  mocks.redirect.mockImplementation(() => {
    throw redirectSignal;
  });
  mocks.notFound.mockImplementation(() => {
    throw notFoundSignal;
  });
});

describe("super-admin business-reviews page", () => {
  it("redirects unauthenticated users before market, capability, or queue work", async () => {
    mocks.getClient.mockResolvedValueOnce(null);

    await expect(page({ market: "lafia" })).rejects.toBe(redirectSignal);
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/auth?next=%2Fadmin%2Fbusiness-reviews",
    );
    expect(mocks.listMarkets).not.toHaveBeenCalled();
    expect(mocks.listQueue).not.toHaveBeenCalled();
  });

  it("fails closed for an inactive, ordinary, or malformed capability response without queue access", async () => {
    mocks.getAccess.mockResolvedValueOnce({ allowed: false, error: null });
    await expect(page({ market: "lafia" })).rejects.toBe(notFoundSignal);

    expect(mocks.listQueue).not.toHaveBeenCalled();
  });

  it("validates search params, resolves only the selected active market, and passes a fixed limit", async () => {
    renderToStaticMarkup(
      await page({
        market: "lafia",
        afterMarketId: ids.market,
        afterSubmittedAt: submittedAt,
        afterBusinessId: ids.business,
      }),
    );

    expect(mocks.getAccess).toHaveBeenCalledWith(expect.anything());
    expect(mocks.listQueue).toHaveBeenCalledWith(expect.anything(), {
      marketId: ids.market,
      cursor: {
        marketId: ids.market,
        submittedAt,
        businessId: ids.business,
      },
      limit: 25,
    });
    expect(mocks.queue).toHaveBeenCalledWith(
      expect.objectContaining({
        businesses: expect.any(Array),
        nextHref: null,
      }),
      undefined,
    );

    await expect(page({ market: "Lafia" })).rejects.toBe(notFoundSignal);
    await expect(
      page({
        market: "lafia",
        afterMarketId: "33333333-3333-4333-8333-333333333333",
        afterSubmittedAt: submittedAt,
        afterBusinessId: ids.business,
      }),
    ).rejects.toBe(notFoundSignal);
    expect(mocks.listQueue).toHaveBeenCalledTimes(1);
  });

  it("renders generic unavailable copy without queue data on provider or contract failure", async () => {
    mocks.listQueue.mockResolvedValueOnce({
      page: null,
      error: new Error("provider"),
    });
    const unavailable = await page({ market: "lafia" });
    const markup = renderToStaticMarkup(unavailable);

    expect(markup).toMatch(/temporarily unavailable/i);
    expect(markup).not.toContain("Amina's Fresh Produce");
    expect(markup).not.toMatch(/super.?admin|capability|provider/i);
  });
});

describe("super-admin business-reviews route boundary", () => {
  it("is dynamic, noindex, and never imports a service-role client or mutation action", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/admin/business-reviews/page.tsx"),
      "utf8",
    );

    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toMatch(/robots:\s*\{\s*index:\s*false/i);
    expect(source).toContain("getServerSupabaseClient");
    expect(source).not.toContain("@/lib/supabase/admin");
    expect(source).not.toMatch(
      /SUPABASE_SERVICE_ROLE_KEY|transition_business_status|set_profile_suspension/i,
    );
  });

  it("keeps focus indicators contrasted and the admin header reflowable", () => {
    const globalCss = readFileSync(
      resolve(process.cwd(), "app/globals.css"),
      "utf8",
    );
    const adminCss = readFileSync(
      resolve(process.cwd(), "components/admin/business-triage.module.css"),
      "utf8",
    );

    expect(globalCss).toContain("--focus: #d65a0a");
    expect(adminCss).toMatch(
      /@media\s*\(max-width:\s*800px\)[\s\S]*?\.headerInner\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?\}/,
    );
    expect(adminCss).toMatch(
      /@media\s*\(max-width:\s*800px\)[\s\S]*?\.workspaceLabel\s*\{[\s\S]*?flex-basis:\s*100%;[\s\S]*?\}/,
    );
  });
});
