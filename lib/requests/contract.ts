import { z } from "zod";

export const REQUEST_DETAILS_MAX_LENGTH = 2_000;
export const REQUEST_SEARCH_CONTEXT_MAX_LENGTH = 160;

export const listingRequestActionSchema = z.enum([
  "enquire",
  "request-booking",
]);
export const listingRequestStatusSchema = z.enum([
  "open",
  "accepted",
  "declined",
  "matched",
  "closed",
  "cancelled",
]);
export const vendorRequestDecisionSchema = z.enum(["accept", "decline"]);
export const vendorDecisionIdempotencyKeySchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "Use a UUID version 4 idempotency key.",
  );
export const vendorRequestResponseOutcomeSchema = z.enum([
  "transitioned",
  "replayed",
  "already_transitioned",
  "conflict",
  "not_found",
  "invalid",
  "idempotency_key_reused",
  "rate_limited",
]);
export const marketSlugSchema = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const listingRouteSchema = z
  .string()
  .max(201)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*~[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const listingRequestNumberSchema = z
  .string()
  .regex(/^LR-[0-9]{6}-[0-9]{10}$/);

export const requestIntentIdSchema = z.string().uuid();

export const requestDetailsSchema = z
  .string()
  .trim()
  .max(REQUEST_DETAILS_MAX_LENGTH)
  .transform((value) => value || null);

export type ListingRequestAction = z.infer<typeof listingRequestActionSchema>;

export type ListingRequestIntentContext = {
  id: string;
  listingId: string;
  marketSlug: string;
  listingRoute: string;
  listingTitle: string;
  vendorName: string;
  requestedAction: ListingRequestAction;
  searchContext: string | null;
  expiresAt: string;
  existingRequestId?: string;
  requestNumber?: string;
  requestStatus?: z.infer<typeof listingRequestStatusSchema>;
  requestCreatedAt?: string;
};

export type ListingRequestRecord = {
  id: string;
  requestNumber: string;
  listingId: string;
  status: z.infer<typeof listingRequestStatusSchema>;
  requestedAction: ListingRequestAction;
  details: string | null;
  createdAt: string;
  vendorRespondedAt: string | null;
  listingTitle?: string;
  marketSlug?: string;
  vendorName?: string;
};

export type VendorRequestResponse = {
  outcome: z.infer<typeof vendorRequestResponseOutcomeSchema>;
  retryable: boolean;
  requestId: string | null;
  status: "accepted" | "declined" | null;
  vendorRespondedAt: string | null;
  updatedAt: string | null;
};

export type ListingRequestStatusPresentation = {
  title: string;
  description: string;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Never expose internal lifecycle values directly in product UI. */
export function presentListingRequestStatus(
  status: z.infer<typeof listingRequestStatusSchema>,
): ListingRequestStatusPresentation {
  switch (status) {
    case "open":
      return {
        title: "Waiting for vendor response",
        description:
          "The vendor has not responded yet. No booking, order, or payment has been created.",
      };
    case "accepted":
      return {
        title: "Vendor accepted for follow-up",
        description:
          "The vendor accepted this request for follow-up only. No booking, order, or payment has been created.",
      };
    case "declined":
      return {
        title: "Vendor declined",
        description:
          "The vendor declined this request. No booking, order, or payment has been created.",
      };
    case "matched":
      return {
        title: "Request is being reviewed",
        description:
          "This earlier request state does not confirm a vendor response, booking, order, or payment.",
      };
    case "closed":
      return {
        title: "Request is no longer active",
        description:
          "This request is closed. It does not confirm a vendor response, booking, order, or payment.",
      };
    case "cancelled":
      return {
        title: "Request was cancelled",
        description:
          "This request was cancelled. No booking, order, or payment was created.",
      };
  }
}

function text(value: unknown, maximumLength = 256): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximumLength
    ? value.trim()
    : null;
}

function isoTimestamp(value: unknown): string | null {
  const candidate = text(value, 64);
  return candidate &&
    /^\d{4}-\d{2}-\d{2}T/.test(candidate) &&
    Number.isFinite(Date.parse(candidate))
    ? candidate
    : null;
}

/** Maps only the typed, presentation-safe fields returned by request RPCs. */
export function parseRequestIntentContext(
  value: unknown,
): ListingRequestIntentContext | null {
  const row = object(value);
  const id = requestIntentIdSchema.safeParse(row?.id ?? row?.intent_id);
  const listingId = requestIntentIdSchema.safeParse(row?.listing_id);
  const marketSlug = marketSlugSchema.safeParse(row?.market_slug);
  const listingRoute = listingRouteSchema.safeParse(row?.listing_route);
  const listingTitle = text(row?.listing_title, 240);
  const vendorName = text(row?.vendor_name, 240);
  const requestedAction = listingRequestActionSchema.safeParse(
    row?.requested_action,
  );
  const searchContext = text(
    row?.search_context,
    REQUEST_SEARCH_CONTEXT_MAX_LENGTH,
  );
  const expiresAt = isoTimestamp(row?.expires_at);
  const existingRequestId = requestIntentIdSchema.safeParse(row?.request_id);
  const requestNumber = listingRequestNumberSchema.safeParse(
    row?.request_number,
  );
  const requestStatus = listingRequestStatusSchema.safeParse(
    row?.request_status,
  );
  const requestCreatedAt = isoTimestamp(row?.request_created_at);
  const hasExistingRequest =
    row?.request_id !== null && row?.request_id !== undefined;

  if (
    !id.success ||
    !listingId.success ||
    !marketSlug.success ||
    !listingRoute.success ||
    !listingTitle ||
    !vendorName ||
    !expiresAt ||
    !requestedAction.success ||
    (hasExistingRequest &&
      (!existingRequestId.success ||
        !requestNumber.success ||
        !requestStatus.success ||
        !requestCreatedAt))
  ) {
    return null;
  }
  return {
    id: id.data,
    listingId: listingId.data,
    marketSlug: marketSlug.data,
    listingRoute: listingRoute.data,
    listingTitle,
    vendorName,
    requestedAction: requestedAction.data,
    searchContext,
    expiresAt,
    existingRequestId: existingRequestId.success
      ? existingRequestId.data
      : undefined,
    requestNumber: requestNumber.success ? requestNumber.data : undefined,
    requestStatus: requestStatus.success ? requestStatus.data : undefined,
    requestCreatedAt: requestCreatedAt ?? undefined,
  };
}

export function parseListingRequest(
  value: unknown,
): ListingRequestRecord | null {
  const row = object(value);
  const id = requestIntentIdSchema.safeParse(row?.id ?? row?.request_id);
  const requestNumber = listingRequestNumberSchema.safeParse(
    row?.request_number,
  );
  const listingId = requestIntentIdSchema.safeParse(row?.listing_id);
  const requestedAction = listingRequestActionSchema.safeParse(
    row?.requested_action,
  );
  const createdAt = isoTimestamp(row?.created_at);
  const status = listingRequestStatusSchema.safeParse(row?.status);
  const vendorRespondedAt =
    row?.vendor_responded_at === null || row?.vendor_responded_at === undefined
      ? null
      : isoTimestamp(row.vendor_responded_at);
  if (
    !id.success ||
    !requestNumber.success ||
    !listingId.success ||
    !status.success ||
    !requestedAction.success ||
    !createdAt ||
    (vendorRespondedAt === null &&
      row?.vendor_responded_at !== null &&
      row?.vendor_responded_at !== undefined)
  ) {
    return null;
  }
  if (
    (status.data === "open" && vendorRespondedAt !== null) ||
    ((status.data === "accepted" || status.data === "declined") &&
      vendorRespondedAt === null) ||
    ((status.data === "matched" ||
      status.data === "closed" ||
      status.data === "cancelled") &&
      vendorRespondedAt !== null)
  ) {
    return null;
  }
  return {
    id: id.data,
    requestNumber: requestNumber.data,
    listingId: listingId.data,
    status: status.data,
    requestedAction: requestedAction.data,
    details: text(row?.details, REQUEST_DETAILS_MAX_LENGTH),
    createdAt,
    vendorRespondedAt,
    listingTitle: text(row?.listing_title, 240) ?? undefined,
    marketSlug: marketSlugSchema.safeParse(row?.market_slug).data ?? undefined,
    vendorName: text(row?.vendor_name, 240) ?? undefined,
  };
}

const vendorRequestResponseWireSchema = z
  .object({
    outcome: vendorRequestResponseOutcomeSchema,
    retryable: z.boolean(),
    request_id: requestIntentIdSchema.nullable(),
    status: listingRequestStatusSchema.nullable(),
    vendor_responded_at: z.string().trim().max(64).nullable(),
    updated_at: z.string().trim().max(64).nullable(),
  })
  .strict();

/**
 * Accept only the deliberately small response projection from the vendor
 * transition RPC. A partial row could cause the UI to claim a response that
 * was not actually persisted, so it is rejected rather than guessed at.
 */
export function parseVendorRequestResponse(
  value: unknown,
): VendorRequestResponse | null {
  const parsed = vendorRequestResponseWireSchema.safeParse(value);
  if (!parsed.success) return null;

  const row = parsed.data;
  const vendorRespondedAt =
    row.vendor_responded_at === null
      ? null
      : isoTimestamp(row.vendor_responded_at);
  const updatedAt =
    row.updated_at === null ? null : isoTimestamp(row.updated_at);
  const status =
    row.status === "accepted" || row.status === "declined" ? row.status : null;
  const hasAnyRowValue =
    row.request_id !== null ||
    row.status !== null ||
    row.vendor_responded_at !== null ||
    row.updated_at !== null;
  const hasCompleteRow =
    row.request_id !== null &&
    status !== null &&
    vendorRespondedAt !== null &&
    updatedAt !== null;
  const requiresRow =
    row.outcome === "transitioned" || row.outcome === "replayed";
  const mayIncludeRow =
    row.outcome === "already_transitioned" || row.outcome === "conflict";
  const retryableOutcome = row.outcome === "rate_limited";

  if (
    (vendorRespondedAt === null && row.vendor_responded_at !== null) ||
    (updatedAt === null && row.updated_at !== null) ||
    (hasAnyRowValue && !hasCompleteRow) ||
    (requiresRow && !hasCompleteRow) ||
    (!mayIncludeRow && !requiresRow && hasAnyRowValue) ||
    row.retryable !== retryableOutcome
  ) {
    return null;
  }

  return {
    outcome: row.outcome,
    retryable: row.retryable,
    requestId: row.request_id,
    status,
    vendorRespondedAt,
    updatedAt,
  };
}

export function parseListingRequestList(
  value: unknown,
): ListingRequestRecord[] | null {
  if (!Array.isArray(value)) return null;
  const requests: ListingRequestRecord[] = [];
  for (const item of value) {
    const request = parseListingRequest(item);
    if (!request) return null;
    requests.push(request);
  }
  return requests;
}
