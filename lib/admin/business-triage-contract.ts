import { z } from "zod";

export const SUPER_ADMIN_BUSINESS_TRIAGE_PAGE_SIZE = 25;
export const SUPER_ADMIN_BUSINESS_TRIAGE_MAX_PAGE_SIZE = 50;

const lowerUuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const routeSlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const timestampSchema = z.string().datetime({ offset: true });
const alreadyTrimmedText = (minimum: number, maximum: number) =>
  z
    .string()
    .min(minimum)
    .max(maximum)
    .refine((value) => value === value.trim());

const categorySlugSchema = z.enum([
  "food-catering",
  "electronics-repair",
  "photography-media",
  "fashion-tailoring",
  "beauty-personal-care",
  "home-building-services",
  "events-venues",
  "transport-logistics",
  "education-training",
  "other-local-trade",
]);

const pendingBusinessWireSchema = z
  .object({
    business_id: lowerUuidSchema,
    business_name: alreadyTrimmedText(2, 160),
    market_id: lowerUuidSchema,
    market_slug: routeSlugSchema,
    market_name: alreadyTrimmedText(2, 160),
    category_slug: categorySlugSchema,
    submitted_at: timestampSchema,
    has_more: z.boolean(),
  })
  .strict();

const activeAdminMarketWireSchema = z
  .object({
    id: lowerUuidSchema,
    name: alreadyTrimmedText(2, 160),
    slug: routeSlugSchema,
  })
  .strict();

const businessTriageSearchParamsSchema = z
  .object({
    market: routeSlugSchema.optional(),
    afterMarketId: lowerUuidSchema.optional(),
    afterSubmittedAt: timestampSchema.optional(),
    afterBusinessId: lowerUuidSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const cursorParts = [
      value.afterMarketId,
      value.afterSubmittedAt,
      value.afterBusinessId,
    ].filter(Boolean).length;
    if (cursorParts !== 0 && cursorParts !== 3) {
      context.addIssue({
        code: "custom",
        message: "The business triage cursor must be complete.",
      });
    }
    if (!value.market && cursorParts > 0) {
      context.addIssue({
        code: "custom",
        message: "A market is required for a business triage cursor.",
      });
    }
  });

export type BusinessTriageCursor = {
  marketId: string;
  submittedAt: string;
  businessId: string;
};

export type PendingBusinessTriageItem = {
  businessId: string;
  businessName: string;
  marketId: string;
  marketSlug: string;
  marketName: string;
  categorySlug: z.infer<typeof categorySlugSchema>;
  submittedAt: string;
};

export type SuperAdminPendingBusinessPage = {
  businesses: PendingBusinessTriageItem[];
  hasMore: boolean;
  nextCursor: BusinessTriageCursor | null;
};

export type ActiveAdminMarket = {
  id: string;
  name: string;
  slug: string;
};

export type BusinessTriageSearchParams = {
  marketSlug: string | null;
  cursor: BusinessTriageCursor | null;
};

function subMillisecondNanoseconds(value: string) {
  const fraction = value.match(/\.(\d+)(?:z|[+-]\d{2}:\d{2})$/i)?.[1] ?? "";
  return Number(fraction.padEnd(9, "0").slice(3, 9));
}

function comparePositions(
  left: { submittedAt: string; businessId: string },
  right: { submittedAt: string; businessId: string },
) {
  const millisecondDifference =
    Date.parse(left.submittedAt) - Date.parse(right.submittedAt);
  const timeDifference =
    millisecondDifference ||
    subMillisecondNanoseconds(left.submittedAt) -
      subMillisecondNanoseconds(right.submittedAt);
  return timeDifference || left.businessId.localeCompare(right.businessId);
}

export function parseSuperAdminPendingBusinessPage(
  value: unknown,
  expectedLimit = SUPER_ADMIN_BUSINESS_TRIAGE_PAGE_SIZE,
  expected?: {
    marketId: string;
    cursor: BusinessTriageCursor | null;
  },
): SuperAdminPendingBusinessPage | null {
  if (
    !Number.isInteger(expectedLimit) ||
    expectedLimit < 1 ||
    expectedLimit > SUPER_ADMIN_BUSINESS_TRIAGE_MAX_PAGE_SIZE
  ) {
    return null;
  }
  const parsed = z
    .array(pendingBusinessWireSchema)
    .max(expectedLimit)
    .safeParse(value);
  if (!parsed.success) return null;

  const rows = parsed.data;
  const hasMore = rows[0]?.has_more ?? false;
  if (rows.some((row) => row.has_more !== hasMore)) return null;
  if (hasMore && rows.length !== expectedLimit) return null;

  const seen = new Set<string>();
  const firstMarket = rows[0]
    ? {
        id: rows[0].market_id,
        slug: rows[0].market_slug,
        name: rows[0].market_name,
      }
    : null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (seen.has(row.business_id)) return null;
    seen.add(row.business_id);
    if (
      firstMarket &&
      (row.market_id !== firstMarket.id ||
        row.market_slug !== firstMarket.slug ||
        row.market_name !== firstMarket.name)
    ) {
      return null;
    }
    if (expected && row.market_id !== expected.marketId) return null;
    const position = {
      submittedAt: row.submitted_at,
      businessId: row.business_id,
    };
    if (
      index === 0 &&
      expected?.cursor &&
      comparePositions(position, expected.cursor) <= 0
    ) {
      return null;
    }
    if (
      index > 0 &&
      comparePositions(
        {
          submittedAt: rows[index - 1].submitted_at,
          businessId: rows[index - 1].business_id,
        },
        position,
      ) >= 0
    ) {
      return null;
    }
  }

  const businesses = rows.map((row) => ({
    businessId: row.business_id,
    businessName: row.business_name,
    marketId: row.market_id,
    marketSlug: row.market_slug,
    marketName: row.market_name,
    categorySlug: row.category_slug,
    submittedAt: row.submitted_at,
  }));
  const finalBusiness = businesses.at(-1);
  return {
    businesses,
    hasMore,
    nextCursor:
      hasMore && finalBusiness
        ? {
            marketId: finalBusiness.marketId,
            submittedAt: finalBusiness.submittedAt,
            businessId: finalBusiness.businessId,
          }
        : null,
  };
}

export function parseActiveAdminMarkets(
  value: unknown,
): ActiveAdminMarket[] | null {
  const parsed = z.array(activeAdminMarketWireSchema).max(50).safeParse(value);
  if (!parsed.success) return null;
  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();
  for (const market of parsed.data) {
    if (seenIds.has(market.id) || seenSlugs.has(market.slug)) return null;
    seenIds.add(market.id);
    seenSlugs.add(market.slug);
  }
  return parsed.data;
}

export function parseBusinessTriageSearchParams(
  value: unknown,
): BusinessTriageSearchParams | null {
  const parsed = businessTriageSearchParamsSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    marketSlug: parsed.data.market ?? null,
    cursor:
      parsed.data.afterMarketId &&
      parsed.data.afterSubmittedAt &&
      parsed.data.afterBusinessId
        ? {
            marketId: parsed.data.afterMarketId,
            submittedAt: parsed.data.afterSubmittedAt,
            businessId: parsed.data.afterBusinessId,
          }
        : null,
  };
}
