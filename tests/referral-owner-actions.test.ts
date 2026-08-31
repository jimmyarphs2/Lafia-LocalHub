import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  create: vi.fn(),
  ensure: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  getClient: vi.fn(),
  getMarket: vi.fn(),
  getUser: vi.fn(),
  list: vi.fn(),
  revalidatePath: vi.fn(),
  select: vi.fn(),
  toggle: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: mocks.getClient,
}));
vi.mock("@/lib/referrals/rpc", () => ({
  createOrGetMyReferralLink: mocks.create,
  ensureMyReferrerIdentity: mocks.ensure,
  listMyReferralLinks: mocks.list,
  setMyReferralLinkEnabled: mocks.toggle,
}));

import {
  createMerchantReferralLink,
  setMerchantReferralLinkEnabled,
} from "@/app/[market]/refer/merchant/actions";

const marketId = "11111111-1111-4111-8111-111111111111";
const linkId = "22222222-2222-4222-8222-222222222222";
const otherMarketId = "33333333-3333-4333-8333-333333333333";
const code = "0123456789abcdef0123456789abcdef";

function link(overrides: Record<string, unknown> = {}) {
  return {
    linkId,
    code,
    marketId,
    target: "merchant_onboarding",
    status: "active",
    expiresAt: null,
    ...overrides,
  };
}

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

function form(values: Record<string, string | readonly string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      data.append(key, item);
    }
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
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
  mocks.create.mockResolvedValue({ link: link(), error: null });
  mocks.list.mockResolvedValue({ links: [link()], error: null });
  mocks.toggle.mockResolvedValue({ link: link(), error: null });
});

describe("create merchant referral link action", () => {
  it("rejects malformed or duplicate market values before client access", async () => {
    await expect(
      createMerchantReferralLink(null, form({ market: "Lafia" })),
    ).resolves.toMatchObject({ ok: false, code: "validation" });
    await expect(
      createMerchantReferralLink(null, form({ market: ["lafia", "abuja"] })),
    ).resolves.toMatchObject({ ok: false, code: "validation" });
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("repeats authentication and active-profile checks before referral work", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(
      createMerchantReferralLink(null, form({ market: "lafia" })),
    ).resolves.toMatchObject({ ok: false, code: "unauthorized" });
    expect(mocks.create).not.toHaveBeenCalled();

    mocks.active.mockResolvedValueOnce({ data: false, error: null });
    await expect(
      createMerchantReferralLink(null, form({ market: "lafia" })),
    ).resolves.toMatchObject({ ok: false, code: "unauthorized" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects an inactive or mismatched market before creating", async () => {
    mocks.getMarket.mockResolvedValueOnce({ data: null, error: null });
    await expect(
      createMerchantReferralLink(null, form({ market: "lafia" })),
    ).resolves.toMatchObject({ ok: false, code: "validation" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("revalidates only a strict same-market success and returns no link secret", async () => {
    const result = await createMerchantReferralLink(
      null,
      form({ market: "lafia" }),
    );
    expect(mocks.create).toHaveBeenCalledWith(expect.anything(), marketId);
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/lafia/refer/merchant");
    expect(result).toMatchObject({ ok: true, code: "created" });
    expect(result).not.toHaveProperty("link");
    expect(result).not.toHaveProperty("linkId");
    expect(result).not.toHaveProperty("referralCode");

    vi.clearAllMocks();
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
    mocks.create.mockResolvedValue({
      link: link({ marketId: otherMarketId }),
      error: null,
    });
    await expect(
      createMerchantReferralLink(null, form({ market: "lafia" })),
    ).resolves.toMatchObject({ ok: false, code: "unavailable" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("toggle merchant referral link action", () => {
  it("rejects malformed UUID, boolean, and duplicate values before client access", async () => {
    for (const values of [
      { market: "lafia", link_id: "not-a-uuid", enabled: "true" },
      { market: "lafia", link_id: linkId, enabled: "yes" },
      {
        market: "lafia",
        link_id: linkId,
        enabled: ["true", "false"] as const,
      },
    ]) {
      await expect(
        setMerchantReferralLinkEnabled(null, form(values)),
      ).resolves.toMatchObject({ ok: false, code: "validation" });
    }
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.toggle).not.toHaveBeenCalled();
  });

  it("prevents a same-owner link from another market being toggled", async () => {
    mocks.list.mockResolvedValueOnce({
      links: [link({ marketId: otherMarketId })],
      error: null,
    });
    await expect(
      setMerchantReferralLinkEnabled(
        null,
        form({ market: "lafia", link_id: linkId, enabled: "false" }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "validation" });
    expect(mocks.toggle).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("toggles only an exact listed link and revalidates strict success", async () => {
    mocks.toggle.mockResolvedValueOnce({
      link: link({ status: "disabled" }),
      error: null,
    });
    const result = await setMerchantReferralLinkEnabled(
      null,
      form({ market: "lafia", link_id: linkId, enabled: "false" }),
    );

    expect(mocks.list).toHaveBeenCalledWith(expect.anything());
    expect(mocks.toggle).toHaveBeenCalledWith(expect.anything(), {
      linkId,
      enabled: false,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/lafia/refer/merchant");
    expect(result).toMatchObject({ ok: true, code: "updated" });
    expect(result).not.toHaveProperty("link");
    expect(result).not.toHaveProperty("referralCode");
  });
});
