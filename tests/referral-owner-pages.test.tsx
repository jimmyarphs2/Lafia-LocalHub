import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  getClient: vi.fn(),
  getMarket: vi.fn(),
  getUser: vi.fn(),
  list: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
  select: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: mocks.getClient,
}));
vi.mock("@/lib/referrals/rpc", () => ({
  listMyReferralLinks: mocks.list,
}));
vi.mock("@/app/[market]/refer/merchant/referral-link-controls", () => ({
  ReferralCreateForm: ({ market }: { market: string }) => (
    <div data-create-market={market}>Create control</div>
  ),
  ReferralToggleForm: ({ market }: { market: string }) => (
    <div data-toggle-market={market}>Toggle control</div>
  ),
}));

import ReferralOwnerPage from "@/app/[market]/refer/merchant/page";
import ReferralDisclosurePage from "@/app/[market]/vendor/onboarding/referral/page";

const redirectSignal = new Error("NEXT_REDIRECT");
const notFoundSignal = new Error("NEXT_NOT_FOUND");
const marketId = "11111111-1111-4111-8111-111111111111";
const linkId = "22222222-2222-4222-8222-222222222222";
const code = "0123456789abcdef0123456789abcdef";

function query() {
  const builder = {
    eq: mocks.eq,
    maybeSingle: mocks.getMarket,
    select: mocks.select,
  };
  mocks.select.mockReturnValue(builder);
  mocks.eq.mockReturnValue(builder);
  return builder;
}

function client() {
  return {
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.active,
  };
}

function ownerPage(market = "lafia") {
  return ReferralOwnerPage({ params: Promise.resolve({ market }) } as never);
}

function disclosurePage(market = "lafia") {
  return ReferralDisclosurePage({
    params: Promise.resolve({ market }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => {
    throw redirectSignal;
  });
  mocks.notFound.mockImplementation(() => {
    throw notFoundSignal;
  });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "owner" } },
    error: null,
  });
  mocks.active.mockResolvedValue({ data: true, error: null });
  mocks.getMarket.mockResolvedValue({
    data: { id: marketId, slug: "lafia" },
    error: null,
  });
  mocks.from.mockReturnValue(query());
  mocks.getClient.mockResolvedValue(client());
  mocks.list.mockResolvedValue({ links: [], error: null });
});

describe("referral owner dashboard page", () => {
  it("rejects a malformed market before authentication or referral reads", async () => {
    await expect(ownerPage("Lafia")).rejects.toBe(notFoundSignal);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated visitor before active-profile, market, or referral work", async () => {
    mocks.getClient.mockResolvedValueOnce(null);

    await expect(ownerPage()).rejects.toBe(redirectSignal);
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/auth?next=%2Flafia%2Frefer%2Fmerchant",
    );
    expect(mocks.active).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("fails closed for an inactive profile or non-canonical active market", async () => {
    mocks.active.mockResolvedValueOnce({ data: false, error: null });
    await expect(ownerPage()).rejects.toBe(notFoundSignal);
    expect(mocks.list).not.toHaveBeenCalled();

    mocks.active.mockResolvedValueOnce({ data: true, error: null });
    mocks.getMarket.mockResolvedValueOnce({
      data: { id: marketId, slug: "abuja" },
      error: null,
    });
    await expect(ownerPage()).rejects.toBe(notFoundSignal);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("uses a read-only owner list for the exact active market", async () => {
    mocks.list.mockResolvedValueOnce({
      links: [
        {
          linkId,
          code,
          marketId,
          target: "merchant_onboarding",
          status: "active",
          expiresAt: null,
        },
      ],
      error: null,
    });

    const markup = renderToStaticMarkup(await ownerPage());

    expect(mocks.active).toHaveBeenCalledWith("is_current_profile_active");
    expect(mocks.from).toHaveBeenCalledWith("markets");
    expect(mocks.eq).toHaveBeenCalledWith("slug", "lafia");
    expect(mocks.eq).toHaveBeenCalledWith("is_active", true);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(markup).toContain(`/r/${code}`);
    expect(markup).toContain('data-toggle-market="lafia"');
    expect(markup).not.toContain("Create control");
  });

  it("contains a referral outage without rendering unverified link data", async () => {
    mocks.list.mockResolvedValueOnce({
      links: [
        {
          linkId,
          code,
          marketId,
          target: "merchant_onboarding",
          status: "active",
          expiresAt: null,
        },
      ],
      error: new Error("offline"),
    });

    const markup = renderToStaticMarkup(await ownerPage());
    expect(markup).toMatch(/temporarily unavailable/i);
    expect(markup).not.toContain(code);
  });
});

describe("referral owner route boundaries", () => {
  it("keeps GET dynamic, noindex, read-only, and user-session only", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/[market]/refer/merchant/page.tsx"),
      "utf8",
    );
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toMatch(/robots:\s*\{\s*index:\s*false/i);
    expect(source).toContain("listMyReferralLinks");
    expect(source).not.toMatch(
      /ensureMyReferrerIdentity|createOrGetMyReferralLink|setMyReferralLinkEnabled/,
    );
    expect(source).not.toMatch(/supabase\/admin|service_role|searchParams/);
  });

  it("ships accessible pending forms without exposing action responses", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "app/[market]/refer/merchant/referral-link-controls.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("useActionState");
    expect(source).toContain("disabled={pending}");
    expect(source).toContain('role="status"');
    expect(source).toMatch(/role=\{state\.ok \? "status" : "alert"\}/);
    expect(source).not.toMatch(/service_role|supabase\/admin/);
  });
});

describe("merchant referral disclosure placeholder", () => {
  it("is public disclosure with a normal onboarding path and no active benefit claim", async () => {
    const markup = renderToStaticMarkup(await disclosurePage());
    expect(markup).toMatch(/not tracking this visit/i);
    expect(markup).toMatch(/referral credit/i);
    expect(markup).toMatch(/rewards? and commissions? are not active/i);
    expect(markup).toContain('href="/vendor/onboarding"');
    expect(markup).not.toContain("<form");
  });

  it("validates the route and remains noindex and pure", async () => {
    await expect(disclosurePage("Lafia")).rejects.toBe(notFoundSignal);

    const source = readFileSync(
      resolve(
        process.cwd(),
        "app/[market]/vendor/onboarding/referral/page.tsx",
      ),
      "utf8",
    );
    expect(source).toMatch(/robots:\s*\{\s*index:\s*false/i);
    expect(source).not.toMatch(
      /searchParams|cookies\(|getServerSupabaseClient|lib\/referrals|use server|<form|action=/i,
    );
  });
});
