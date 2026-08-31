import { describe, expect, it } from "vitest";

import {
  parseReferralAcquisitionLink,
  parseReferralAcquisitionLinkList,
  parseReferralAcquisitionResolution,
  parseReferrerIdentity,
  REFERRAL_LINK_LIST_MAXIMUM,
  referralCodeSchema,
  referralIdSchema,
} from "@/lib/referrals/contract";

const ids = {
  link: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  market: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  profile: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const code = "0123456789abcdef0123456789abcdef";
const createdAt = "2026-08-31T10:00:00.123456+00:00";
const expiresAt = "2026-09-30T10:00:00+00:00";

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

describe("referral acquisition wire contract", () => {
  it("accepts only canonical lowercase UUIDs and 128-bit lowercase hex codes", () => {
    expect(referralIdSchema.safeParse(ids.link).success).toBe(true);
    expect(referralIdSchema.safeParse(ids.link.toUpperCase()).success).toBe(
      false,
    );
    expect(referralCodeSchema.safeParse(code).success).toBe(true);
    for (const value of [
      code.toUpperCase(),
      code.slice(1),
      `${code}0`,
      "g".repeat(32),
      ` ${code}`,
    ]) {
      expect(referralCodeSchema.safeParse(value).success).toBe(false);
    }
  });

  it("maps only the exact referrer identity projection", () => {
    expect(
      parseReferrerIdentity({
        profile_id: ids.profile,
        status: "active",
        created_at: createdAt,
      }),
    ).toEqual({
      profileId: ids.profile,
      status: "active",
      createdAt,
    });
    expect(
      parseReferrerIdentity({
        profile_id: ids.profile,
        status: "active",
        created_at: createdAt,
        email: "private@example.test",
      }),
    ).toBeNull();
    expect(
      parseReferrerIdentity({
        profile_id: ids.profile,
        status: "unknown",
        created_at: createdAt,
      }),
    ).toBeNull();
  });

  it("maps only the exact non-financial referral link projection", () => {
    expect(parseReferralAcquisitionLink(linkRow())).toEqual({
      linkId: ids.link,
      code,
      marketId: ids.market,
      target: "merchant_onboarding",
      status: "active",
      expiresAt: null,
    });
    expect(
      parseReferralAcquisitionLink(
        linkRow({ status: "disabled", expires_at: expiresAt }),
      ),
    ).toMatchObject({ status: "disabled", expiresAt });

    for (const row of [
      linkRow({ link_id: "not-a-uuid" }),
      linkRow({ code: code.toUpperCase() }),
      linkRow({ target: "customer_checkout" }),
      linkRow({ status: "pending" }),
      linkRow({ status: "expired", expires_at: null }),
      linkRow({ expires_at: "tomorrow" }),
      linkRow({ referrer_profile_id: ids.profile }),
      linkRow({ phone_e164: "+2348000000000" }),
      linkRow({ commission_rate: 10 }),
    ]) {
      expect(parseReferralAcquisitionLink(row)).toBeNull();
    }
  });

  it("requires expired links to carry a valid expiry timestamp", () => {
    expect(
      parseReferralAcquisitionLink(
        linkRow({ status: "expired", expires_at: expiresAt }),
      ),
    ).toEqual({
      linkId: ids.link,
      code,
      marketId: ids.market,
      target: "merchant_onboarding",
      status: "expired",
      expiresAt,
    });

    for (const expires_at of [null, "tomorrow"]) {
      expect(
        parseReferralAcquisitionLink(
          linkRow({ status: "expired", expires_at }),
        ),
      ).toBeNull();
    }

    for (const status of ["active", "disabled"] as const) {
      expect(
        parseReferralAcquisitionLink(linkRow({ status, expires_at: null })),
      ).toMatchObject({ status, expiresAt: null });
      expect(
        parseReferralAcquisitionLink(
          linkRow({ status, expires_at: expiresAt }),
        ),
      ).toMatchObject({ status, expiresAt });
    }
  });

  it("bounds owner lists and rejects duplicate identities, codes, or market targets", () => {
    expect(parseReferralAcquisitionLinkList([])).toEqual([]);
    expect(parseReferralAcquisitionLinkList([linkRow()])).toHaveLength(1);
    expect(
      parseReferralAcquisitionLinkList([
        linkRow(),
        linkRow({
          link_id: "44444444-4444-4444-8444-444444444444",
          market_id: "55555555-5555-4555-8555-555555555555",
        }),
      ]),
    ).toBeNull();
    expect(
      parseReferralAcquisitionLinkList([
        linkRow(),
        linkRow({
          code: "11111111111111111111111111111111",
          market_id: "55555555-5555-4555-8555-555555555555",
        }),
      ]),
    ).toBeNull();
    expect(
      parseReferralAcquisitionLinkList([
        linkRow(),
        linkRow({
          link_id: "44444444-4444-4444-8444-444444444444",
          code: "11111111111111111111111111111111",
        }),
      ]),
    ).toBeNull();

    const oversized = Array.from(
      { length: REFERRAL_LINK_LIST_MAXIMUM + 1 },
      (_, index) => {
        const suffix = index.toString(16).padStart(12, "0");
        const marketSuffix = (index + 1_000).toString(16).padStart(12, "0");
        return linkRow({
          link_id: `11111111-1111-4111-8111-${suffix}`,
          code: index.toString(16).padStart(32, "0"),
          market_id: `22222222-2222-4222-8222-${marketSuffix}`,
        });
      },
    );
    expect(parseReferralAcquisitionLinkList(oversized)).toBeNull();
    expect(parseReferralAcquisitionLinkList(linkRow())).toBeNull();
  });

  it("enforces outcome-specific resolver nullability and the exact canonical target", () => {
    const valid = {
      outcome: "valid",
      market_slug: "lafia",
      target: "merchant_onboarding",
      canonical_target_path: "/lafia/vendor/onboarding/referral",
      expires_at: null,
    };
    expect(parseReferralAcquisitionResolution(valid)).toEqual({
      outcome: "valid",
      marketSlug: "lafia",
      target: "merchant_onboarding",
      canonicalTargetPath: "/lafia/vendor/onboarding/referral",
      expiresAt: null,
    });
    expect(
      parseReferralAcquisitionResolution({
        ...valid,
        outcome: "expired",
        expires_at: expiresAt,
      }),
    ).toMatchObject({ outcome: "expired", expiresAt });
    expect(
      parseReferralAcquisitionResolution({
        outcome: "invalid",
        market_slug: null,
        target: null,
        canonical_target_path: null,
        expires_at: null,
      }),
    ).toEqual({
      outcome: "invalid",
      marketSlug: null,
      target: null,
      canonicalTargetPath: null,
      expiresAt: null,
    });

    for (const row of [
      { ...valid, canonical_target_path: "//attacker.example" },
      { ...valid, canonical_target_path: "/jos/vendor/onboarding/referral" },
      { ...valid, canonical_target_path: "/lafia/vendor/onboarding" },
      { ...valid, market_slug: "Lafia" },
      { ...valid, target: "merchant_checkout" },
      { ...valid, outcome: "pending" },
      { ...valid, outcome: "expired", expires_at: null },
      {
        outcome: "invalid",
        market_slug: "lafia",
        target: null,
        canonical_target_path: null,
        expires_at: null,
      },
      { ...valid, referrer_profile_id: ids.profile },
    ]) {
      expect(parseReferralAcquisitionResolution(row)).toBeNull();
    }
  });
});
