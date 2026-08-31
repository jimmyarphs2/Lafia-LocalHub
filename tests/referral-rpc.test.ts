import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createOrGetMyReferralLink,
  ensureMyReferrerIdentity,
  listMyReferralLinks,
  resolveReferralAcquisitionLink,
  setMyReferralLinkEnabled,
} from "@/lib/referrals/rpc";

const ids = {
  link: "11111111-1111-4111-8111-111111111111",
  market: "22222222-2222-4222-8222-222222222222",
  profile: "33333333-3333-4333-8333-333333333333",
};
const code = "0123456789abcdef0123456789abcdef";
const createdAt = "2026-08-31T10:00:00+00:00";
const expiresAt = "2026-09-30T10:00:00+00:00";
const rpc = vi.fn();
const client = { rpc } as never;

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    link_id: ids.link,
    code,
    market_id: ids.market,
    target: "merchant_onboarding",
    status: "active",
    expires_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  rpc.mockReset();
});

describe("referral acquisition RPC adapter", () => {
  it("calls each owner RPC with its exact generated argument contract", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        { profile_id: ids.profile, status: "active", created_at: createdAt },
      ],
      error: null,
    });
    await expect(ensureMyReferrerIdentity(client)).resolves.toMatchObject({
      identity: { profileId: ids.profile },
      error: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "ensure_my_referrer_identity");

    rpc.mockResolvedValueOnce({ data: [linkRow()], error: null });
    await expect(
      createOrGetMyReferralLink(client, ids.market),
    ).resolves.toMatchObject({ link: { linkId: ids.link }, error: null });
    expect(rpc).toHaveBeenNthCalledWith(2, "create_or_get_my_referral_link", {
      p_market_id: ids.market,
    });

    rpc.mockResolvedValueOnce({ data: [linkRow()], error: null });
    await expect(listMyReferralLinks(client)).resolves.toMatchObject({
      links: [{ linkId: ids.link }],
      error: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "list_my_referral_links");

    rpc.mockResolvedValueOnce({
      data: [linkRow({ status: "disabled" })],
      error: null,
    });
    await expect(
      setMyReferralLinkEnabled(client, {
        linkId: ids.link,
        enabled: false,
      }),
    ).resolves.toMatchObject({
      link: { linkId: ids.link, status: "disabled" },
      error: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(4, "set_my_referral_link_enabled", {
      p_link_id: ids.link,
      p_enabled: false,
    });

    rpc.mockResolvedValueOnce({
      data: [
        {
          outcome: "valid",
          market_slug: "lafia",
          target: "merchant_onboarding",
          canonical_target_path: "/lafia/vendor/onboarding/referral",
          expires_at: null,
        },
      ],
      error: null,
    });
    await expect(
      resolveReferralAcquisitionLink(client, code),
    ).resolves.toMatchObject({
      resolution: {
        outcome: "valid",
        canonicalTargetPath: "/lafia/vendor/onboarding/referral",
      },
      error: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(
      5,
      "resolve_referral_acquisition_link",
      { p_code: code },
    );
  });

  it("accepts an empty owner list but fails it closed on duplicate or drifted rows", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(listMyReferralLinks(client)).resolves.toEqual({
      links: [],
      error: null,
    });

    rpc.mockResolvedValueOnce({
      data: [linkRow(), linkRow()],
      error: null,
    });
    const duplicate = await listMyReferralLinks(client);
    expect(duplicate.links).toEqual([]);
    expect(duplicate.error?.kind).toBe("contract");

    rpc.mockResolvedValueOnce({
      data: [linkRow({ email: "private@example.test" })],
      error: null,
    });
    const drifted = await listMyReferralLinks(client);
    expect(drifted.links).toEqual([]);
    expect(drifted.error?.kind).toBe("contract");
  });

  it("fails expired owner-link rows closed unless they carry a valid expiry", async () => {
    rpc.mockResolvedValueOnce({
      data: [linkRow({ status: "expired", expires_at: null })],
      error: null,
    });
    const missingExpiry = await listMyReferralLinks(client);
    expect(missingExpiry.links).toEqual([]);
    expect(missingExpiry.error?.kind).toBe("contract");

    rpc.mockResolvedValueOnce({
      data: [linkRow({ status: "expired", expires_at: "tomorrow" })],
      error: null,
    });
    const malformedExpiry = await listMyReferralLinks(client);
    expect(malformedExpiry.links).toEqual([]);
    expect(malformedExpiry.error?.kind).toBe("contract");

    rpc.mockResolvedValueOnce({
      data: [linkRow({ status: "expired", expires_at: expiresAt })],
      error: null,
    });
    await expect(listMyReferralLinks(client)).resolves.toEqual({
      links: [
        {
          linkId: ids.link,
          code,
          marketId: ids.market,
          target: "merchant_onboarding",
          status: "expired",
          expiresAt,
        },
      ],
      error: null,
    });
  });

  it("rejects malformed caller inputs before any database call", async () => {
    const badMarket = await createOrGetMyReferralLink(client, "not-a-uuid");
    expect(badMarket.error?.kind).toBe("contract");

    const badToggle = await setMyReferralLinkEnabled(client, {
      linkId: ids.link,
      enabled: null as never,
    });
    expect(badToggle.error?.kind).toBe("contract");

    const badCode = await resolveReferralAcquisitionLink(
      client,
      code.toUpperCase(),
    );
    expect(badCode.error?.kind).toBe("contract");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["object", linkRow()],
    ["empty", []],
    ["multi-row", [linkRow(), linkRow()]],
    ["malformed row", [linkRow({ code: code.toUpperCase() })]],
  ])(
    "classifies %s singleton output as a contract failure",
    async (_label, data) => {
      rpc.mockResolvedValue({ data, error: null });

      const created = await createOrGetMyReferralLink(client, ids.market);
      expect(created.link).toBeNull();
      expect(created.error?.kind).toBe("contract");
    },
  );

  it("distinguishes provider responses and transport rejection from contract failures", async () => {
    const providerError = new Error("provider unavailable");
    rpc.mockResolvedValueOnce({ data: [linkRow()], error: providerError });
    const provider = await createOrGetMyReferralLink(client, ids.market);
    expect(provider.link).toBeNull();
    expect(provider.error).toEqual({
      kind: "provider",
      cause: providerError,
    });

    const transportError = new Error("network rejected");
    rpc.mockRejectedValueOnce(transportError);
    const transport = await resolveReferralAcquisitionLink(client, code);
    expect(transport.resolution).toBeNull();
    expect(transport.error).toEqual({
      kind: "provider",
      cause: transportError,
    });
  });

  it("rejects malformed resolver cardinality and outcome drift", async () => {
    for (const data of [
      [],
      [
        {
          outcome: "invalid",
          market_slug: null,
          target: null,
          canonical_target_path: null,
          expires_at: null,
        },
        {
          outcome: "invalid",
          market_slug: null,
          target: null,
          canonical_target_path: null,
          expires_at: null,
        },
      ],
      [
        {
          outcome: "valid",
          market_slug: "lafia",
          target: "merchant_onboarding",
          canonical_target_path: "//attacker.example",
          expires_at: null,
        },
      ],
    ]) {
      rpc.mockResolvedValueOnce({ data, error: null });
      const result = await resolveReferralAcquisitionLink(client, code);
      expect(result.resolution).toBeNull();
      expect(result.error?.kind).toBe("contract");
    }
  });
});
