import { z } from "zod";

export const TOOL_GATEWAY_CONTRACT_VERSION = 1 as const;

const uuidSchema = z.string().uuid();
const countSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const observedAtSchema = z.string().datetime({ offset: true });
const marketSlugSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const platformSummaryRequestSchema = z
  .object({
    contractVersion: z.literal(TOOL_GATEWAY_CONTRACT_VERSION),
    tool: z.literal("get_platform_summary"),
    input: z
      .object({
        marketSlug: marketSlugSchema,
      })
      .strict(),
  })
  .strict();

export const platformSummaryDataSchema = z
  .object({
    market: z
      .object({
        id: uuidSchema,
        slug: marketSlugSchema,
        name: z.string().trim().min(1).max(120),
        countryCode: z.string().regex(/^[A-Z]{2}$/),
        currencyCode: z.string().regex(/^[A-Z]{3}$/),
        timezone: z.string().trim().min(1).max(80),
      })
      .strict(),
    activeCategoryCount: countSchema,
    activeVendorCount: countSchema,
    publishedListingCount: countSchema,
    orderableListingCount: countSchema,
  })
  .strict();

const platformSummaryRpcRowSchema = z
  .object({
    invocation_id: uuidSchema,
    audit_event_id: uuidSchema.nullable(),
    outcome: z.enum([
      "succeeded",
      "invalid_input",
      "market_not_found",
      "rate_limited",
    ]),
    observed_at: observedAtSchema,
    market_id: uuidSchema.nullable(),
    market_slug: marketSlugSchema.nullable(),
    market_name: z.string().trim().min(1).max(120).nullable(),
    country_code: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    currency_code: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    timezone: z.string().trim().min(1).max(80).nullable(),
    active_category_count: countSchema.nullable(),
    active_vendor_count: countSchema.nullable(),
    published_listing_count: countSchema.nullable(),
    orderable_listing_count: countSchema.nullable(),
  })
  .strict();

export const platformSummaryResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("succeeded"),
      invocationId: uuidSchema,
      auditEventId: uuidSchema,
      observedAt: observedAtSchema,
      data: platformSummaryDataSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.enum(["invalid_input", "market_not_found"]),
      invocationId: uuidSchema,
      auditEventId: uuidSchema,
      observedAt: observedAtSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal("rate_limited"),
      invocationId: uuidSchema,
      auditEventId: uuidSchema.nullable(),
      observedAt: observedAtSchema,
    })
    .strict(),
]);

export type PlatformSummaryRequest = z.infer<
  typeof platformSummaryRequestSchema
>;
export type PlatformSummaryData = z.infer<typeof platformSummaryDataSchema>;
export type PlatformSummaryResult = z.infer<typeof platformSummaryResultSchema>;

const nullableDataFields = [
  "market_id",
  "market_slug",
  "market_name",
  "country_code",
  "currency_code",
  "timezone",
  "active_category_count",
  "active_vendor_count",
  "published_listing_count",
  "orderable_listing_count",
] as const;

export function parsePlatformSummaryRpcResult(
  value: unknown,
  expected: { invocationId: string; marketSlug: string },
): PlatformSummaryResult | null {
  const rows = z.array(platformSummaryRpcRowSchema).length(1).safeParse(value);
  if (!rows.success) return null;

  const row = rows.data[0];
  if (row.invocation_id !== expected.invocationId) return null;

  if (row.outcome === "succeeded") {
    if (
      !row.audit_event_id ||
      !row.market_id ||
      row.market_slug !== expected.marketSlug ||
      !row.market_name ||
      !row.country_code ||
      !row.currency_code ||
      !row.timezone ||
      row.active_category_count === null ||
      row.active_vendor_count === null ||
      row.published_listing_count === null ||
      row.orderable_listing_count === null
    ) {
      return null;
    }
    return platformSummaryResultSchema.parse({
      outcome: row.outcome,
      invocationId: row.invocation_id,
      auditEventId: row.audit_event_id,
      observedAt: row.observed_at,
      data: {
        market: {
          id: row.market_id,
          slug: row.market_slug,
          name: row.market_name,
          countryCode: row.country_code,
          currencyCode: row.currency_code,
          timezone: row.timezone,
        },
        activeCategoryCount: row.active_category_count,
        activeVendorCount: row.active_vendor_count,
        publishedListingCount: row.published_listing_count,
        orderableListingCount: row.orderable_listing_count,
      },
    });
  }

  if (nullableDataFields.some((field) => row[field] !== null)) return null;
  if (row.outcome !== "rate_limited" && !row.audit_event_id) return null;

  return platformSummaryResultSchema.parse({
    outcome: row.outcome,
    invocationId: row.invocation_id,
    auditEventId: row.audit_event_id,
    observedAt: row.observed_at,
  });
}
