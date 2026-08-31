import { z } from "zod";

export const REFERRAL_LINK_LIST_MAXIMUM = 100;

export const referralIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
export const referralCodeSchema = z.string().regex(/^[0-9a-f]{32}$/);
export const referralTargetSchema = z.literal("merchant_onboarding");
export const referralLinkStatusSchema = z.enum([
  "active",
  "disabled",
  "expired",
]);
export const referralResolutionOutcomeSchema = z.enum([
  "valid",
  "invalid",
  "expired",
]);

const referrerStatusSchema = z.enum(["active", "disabled"]);
const marketSlugSchema = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const timestampSchema = z.string().datetime({ offset: true });

const referrerIdentityWireSchema = z
  .object({
    profile_id: referralIdSchema,
    status: referrerStatusSchema,
    created_at: timestampSchema,
  })
  .strict();

const referralAcquisitionLinkWireSchema = z
  .object({
    link_id: referralIdSchema,
    code: referralCodeSchema,
    market_id: referralIdSchema,
    target: referralTargetSchema,
    status: referralLinkStatusSchema,
    expires_at: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((row, context) => {
    if (row.status === "expired" && row.expires_at === null) {
      context.addIssue({
        code: "custom",
        path: ["expires_at"],
        message: "Expired referral links require an expiry timestamp.",
      });
    }
  });

const referralResolutionWireSchema = z
  .discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("valid"),
        market_slug: marketSlugSchema,
        target: referralTargetSchema,
        canonical_target_path: z.string().max(120),
        expires_at: timestampSchema.nullable(),
      })
      .strict(),
    z
      .object({
        outcome: z.literal("expired"),
        market_slug: marketSlugSchema,
        target: referralTargetSchema,
        canonical_target_path: z.string().max(120),
        expires_at: timestampSchema,
      })
      .strict(),
    z
      .object({
        outcome: z.literal("invalid"),
        market_slug: z.null(),
        target: z.null(),
        canonical_target_path: z.null(),
        expires_at: z.null(),
      })
      .strict(),
  ])
  .superRefine((row, context) => {
    if (
      row.outcome !== "invalid" &&
      row.canonical_target_path !==
        `/${row.market_slug}/vendor/onboarding/referral`
    ) {
      context.addIssue({
        code: "custom",
        path: ["canonical_target_path"],
        message: "Referral target does not match its canonical market route.",
      });
    }
  });

export type ReferrerIdentity = {
  profileId: string;
  status: z.infer<typeof referrerStatusSchema>;
  createdAt: string;
};

export type ReferralAcquisitionLink = {
  linkId: string;
  code: string;
  marketId: string;
  target: z.infer<typeof referralTargetSchema>;
  status: z.infer<typeof referralLinkStatusSchema>;
  expiresAt: string | null;
};

export type ReferralAcquisitionResolution =
  | {
      outcome: "valid";
      marketSlug: string;
      target: "merchant_onboarding";
      canonicalTargetPath: string;
      expiresAt: string | null;
    }
  | {
      outcome: "expired";
      marketSlug: string;
      target: "merchant_onboarding";
      canonicalTargetPath: string;
      expiresAt: string;
    }
  | {
      outcome: "invalid";
      marketSlug: null;
      target: null;
      canonicalTargetPath: null;
      expiresAt: null;
    };

export function parseReferrerIdentity(value: unknown): ReferrerIdentity | null {
  const parsed = referrerIdentityWireSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    profileId: parsed.data.profile_id,
    status: parsed.data.status,
    createdAt: parsed.data.created_at,
  };
}

export function parseReferralAcquisitionLink(
  value: unknown,
): ReferralAcquisitionLink | null {
  const parsed = referralAcquisitionLinkWireSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    linkId: parsed.data.link_id,
    code: parsed.data.code,
    marketId: parsed.data.market_id,
    target: parsed.data.target,
    status: parsed.data.status,
    expiresAt: parsed.data.expires_at,
  };
}

export function parseReferralAcquisitionLinkList(
  value: unknown,
): ReferralAcquisitionLink[] | null {
  const parsed = z
    .array(referralAcquisitionLinkWireSchema)
    .max(REFERRAL_LINK_LIST_MAXIMUM)
    .safeParse(value);
  if (!parsed.success) return null;

  const linkIds = new Set<string>();
  const codes = new Set<string>();
  const marketTargets = new Set<string>();
  const links: ReferralAcquisitionLink[] = [];
  for (const row of parsed.data) {
    const marketTarget = `${row.market_id}:${row.target}`;
    if (
      linkIds.has(row.link_id) ||
      codes.has(row.code) ||
      marketTargets.has(marketTarget)
    ) {
      return null;
    }
    linkIds.add(row.link_id);
    codes.add(row.code);
    marketTargets.add(marketTarget);
    links.push({
      linkId: row.link_id,
      code: row.code,
      marketId: row.market_id,
      target: row.target,
      status: row.status,
      expiresAt: row.expires_at,
    });
  }
  return links;
}

export function parseReferralAcquisitionResolution(
  value: unknown,
): ReferralAcquisitionResolution | null {
  const parsed = referralResolutionWireSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.outcome === "invalid") {
    return {
      outcome: "invalid",
      marketSlug: null,
      target: null,
      canonicalTargetPath: null,
      expiresAt: null,
    };
  }
  if (parsed.data.outcome === "expired") {
    return {
      outcome: "expired",
      marketSlug: parsed.data.market_slug,
      target: parsed.data.target,
      canonicalTargetPath: parsed.data.canonical_target_path,
      expiresAt: parsed.data.expires_at,
    };
  }
  return {
    outcome: "valid",
    marketSlug: parsed.data.market_slug,
    target: parsed.data.target,
    canonicalTargetPath: parsed.data.canonical_target_path,
    expiresAt: parsed.data.expires_at,
  };
}
