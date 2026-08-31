import { z } from "zod";

import { listingRouteSchema, marketSlugSchema } from "@/lib/requests/contract";

export const ORDER_QUANTITY_MINIMUM = 1;
export const ORDER_QUANTITY_MAXIMUM = 100;
export const ORDER_LIST_MAXIMUM = 100;

export const orderIntentIdSchema = z.string().uuid();
export const orderIdSchema = z.string().uuid();
export const orderQuantitySchema = z
  .number()
  .int()
  .min(ORDER_QUANTITY_MINIMUM)
  .max(ORDER_QUANTITY_MAXIMUM);
export const orderQuantityFormSchema = z
  .string()
  .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
  .transform((value) => Number(value));
export const orderNumberSchema = z.string().regex(/^LO-[0-9]{6}-[0-9]{10}$/);
export const orderStatusSchema = z.enum([
  "draft",
  "placed",
  "confirmed",
  "fulfilled",
  "cancelled",
  "refunded",
]);
const listingOrderReadStatusSchema = z.enum([
  "placed",
  "confirmed",
  "cancelled",
]);
export const vendorOrderDecisionSchema = z.enum(["confirm", "cancel"]);
export const vendorOrderDecisionIdempotencyKeySchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    "Use a UUID version 4 idempotency key.",
  );
export const orderFulfilmentIdempotencyKeySchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    "Use a lowercase UUID version 4 idempotency key.",
  );
export const vendorOrderResponseOutcomeSchema = z.enum([
  "transitioned",
  "replayed",
  "already_transitioned",
  "conflict",
  "not_found",
  "invalid",
  "idempotency_key_reused",
  "rate_limited",
]);
export const orderPlacementOutcomeSchema = z.enum([
  "created",
  "replayed",
  "invalid",
  "expired",
  "unavailable",
  "quote_changed",
  "rate_limited",
]);
export const orderFulfilmentResponseOutcomeSchema = z.enum([
  "started",
  "replayed",
  "already_started",
  "idempotency_key_reused",
  "not_found",
  "invalid",
  "rate_limited",
]);

const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
const safeMinorAmountSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
const positiveMinorAmountSchema = safeMinorAmountSchema.min(1);
const defaultIgnorableOrderTextPattern =
  /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufff8\u{1bca0}-\u{1bca3}\u{1d173}-\u{1d17a}\u{e0000}-\u{e0fff}]/u;
const orderSnapshotTextSchema = z
  .string()
  .max(320)
  .refine((value) => {
    const codePointLength = Array.from(value).length;
    return codePointLength >= 2 && codePointLength <= 160;
  })
  .refine((value) => value === value.trim())
  .refine((value) => !/[\p{Cc}]/u.test(value))
  .refine((value) => !defaultIgnorableOrderTextPattern.test(value))
  .refine((value) => /[\p{L}\p{N}]/u.test(value));
const timestampSchema = z
  .string()
  .max(64)
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
    "Use an ISO timestamp.",
  );
const internalPathSchema = z
  .string()
  .max(2048)
  .regex(/^\/(?!\/)/)
  .refine(
    (value) => !value.includes("\\") && !/[\u0000-\u0020\u007f]/.test(value),
  );

export type OrderStatus = z.infer<typeof orderStatusSchema>;

export type OrderStatusPresentation = {
  title: string;
  description: string;
};

export type OrderFulfilment = {
  id: string;
  status: "processing";
  startedAt: string;
  updatedAt: string;
};

export type OrderFulfilmentPresentation = {
  title: string;
  description: string;
};

export type ListingOrderIntentCapability = {
  id: string;
  secret: string;
  expiresAt: string;
};

export type ListingOrderIntentContext = {
  id: string;
  listingId: string;
  businessId: string;
  marketId: string;
  quantity: number;
  returnTo: string;
  marketSlug: string;
  listingRoute: string;
  listingTitle: string;
  vendorName: string;
  currencyCode: string;
  unitPriceMinor: number;
  totalMinor: number;
  claimedAt: string;
  expiresAt: string;
  consumedAt: string | null;
  existingOrderId?: string;
  existingOrderNumber?: string;
  existingOrderStatus?: OrderStatus;
  existingOrderCreatedAt?: string;
};

export type ListingOrderRecord = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  createdAt: string;
  placedAt: string;
  vendorDecidedAt: string | null;
  businessId: string;
  vendorName: string;
  marketSlug: string;
  listingId: string;
  listingRoute: string;
  listingTitle: string;
  quantity: number;
  currencyCode: string;
  unitPriceMinor: number;
  totalMinor: number;
  fulfilment: OrderFulfilment | null;
};

export type OrderPlacementResponse = {
  outcome: z.infer<typeof orderPlacementOutcomeSchema>;
  retryable: boolean;
  order: ListingOrderRecord | null;
};

export type VendorOrderResponse = {
  outcome: z.infer<typeof vendorOrderResponseOutcomeSchema>;
  retryable: boolean;
  orderId: string | null;
  status: "confirmed" | "cancelled" | null;
  vendorDecidedAt: string | null;
  updatedAt: string | null;
};

export type OrderFulfilmentResponse = {
  outcome: z.infer<typeof orderFulfilmentResponseOutcomeSchema>;
  retryable: boolean;
  orderId: string | null;
  orderStatus: "confirmed" | null;
  fulfilmentId: string | null;
  fulfilmentStatus: "processing" | null;
  fulfilmentStartedAt: string | null;
  fulfilmentUpdatedAt: string | null;
};

/** Never expose internal order lifecycle values directly in product UI. */
export function presentOrderStatus(
  status: OrderStatus,
): OrderStatusPresentation {
  switch (status) {
    case "draft":
      return {
        title: "Order not placed",
        description:
          "This order has not been placed and no payment has been collected.",
      };
    case "placed":
      return {
        title: "Placed — awaiting vendor confirmation",
        description:
          "The order is recorded in LocalHub. The vendor has not confirmed it and no payment has been collected.",
      };
    case "confirmed":
      return {
        title: "Vendor confirmed",
        description:
          "The vendor confirmed availability. LocalHub has not collected payment.",
      };
    case "fulfilled":
      return {
        title: "Fulfilled",
        description: "This order is recorded as fulfilled.",
      };
    case "cancelled":
      return {
        title: "Vendor cancelled",
        description:
          "The vendor cancelled this order before payment. LocalHub collected no payment, so no refund was created.",
      };
    case "refunded":
      return {
        title: "Refunded",
        description: "This order is recorded as refunded.",
      };
  }
}

/** Fulfilment is a separate aggregate; it never changes the order status. */
export function presentOrderFulfilment(
  fulfilment: OrderFulfilment,
): OrderFulfilmentPresentation {
  switch (fulfilment.status) {
    case "processing":
      return {
        title: "Vendor is processing your order",
        description:
          "The vendor has recorded that they have begun handling it. LocalHub has not collected payment. Pickup, delivery, handoff, and completion are not yet recorded.",
      };
  }
}

export function formatOrderMoney(
  amountMinor: number,
  currencyCode: string,
): string {
  const amount = safeMinorAmountSchema.parse(amountMinor);
  const currency = currencyCodeSchema.parse(currencyCode);
  const majorUnits = Math.floor(amount / 100);
  const minorUnits = amount - majorUnits * 100;
  const parts = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(majorUnits);

  return parts
    .map((part) =>
      part.type === "fraction"
        ? String(minorUnits).padStart(2, "0")
        : part.value,
    )
    .join("");
}

const capabilityWireSchema = z
  .object({
    id: orderIntentIdSchema,
    secret: z.string().regex(/^[a-f0-9]{64}$/),
    expires_at: timestampSchema,
  })
  .strict();

const intentWireSchema = z
  .object({
    intent_id: orderIntentIdSchema,
    listing_id: orderIdSchema,
    business_id: orderIdSchema,
    market_id: orderIdSchema,
    quantity: orderQuantitySchema,
    return_to: internalPathSchema,
    market_slug: marketSlugSchema,
    listing_route: listingRouteSchema,
    listing_title: orderSnapshotTextSchema,
    vendor_name: orderSnapshotTextSchema,
    currency_code: currencyCodeSchema,
    unit_price_minor: positiveMinorAmountSchema,
    total_minor: positiveMinorAmountSchema,
    claimed_at: timestampSchema,
    expires_at: timestampSchema,
    consumed_at: timestampSchema.nullable(),
    order_id: orderIdSchema.nullable(),
    order_number: orderNumberSchema.nullable(),
    order_status: listingOrderReadStatusSchema.nullable(),
    order_created_at: timestampSchema.nullable(),
  })
  .strict();

const orderWireSchema = z
  .object({
    order_id: orderIdSchema,
    order_number: orderNumberSchema,
    status: listingOrderReadStatusSchema,
    created_at: timestampSchema,
    placed_at: timestampSchema,
    vendor_decided_at: timestampSchema.nullable(),
    business_id: orderIdSchema,
    vendor_name: orderSnapshotTextSchema,
    market_slug: marketSlugSchema,
    listing_id: orderIdSchema,
    listing_route: listingRouteSchema,
    listing_title: orderSnapshotTextSchema,
    quantity: orderQuantitySchema,
    currency_code: currencyCodeSchema,
    unit_price_minor: positiveMinorAmountSchema,
    total_minor: positiveMinorAmountSchema,
    fulfilment_id: orderIdSchema.nullable(),
    fulfilment_status: z.literal("processing").nullable(),
    fulfilment_started_at: timestampSchema.nullable(),
    fulfilment_updated_at: timestampSchema.nullable(),
  })
  .strict();

const placementWireSchema = z
  .object({
    outcome: orderPlacementOutcomeSchema,
    retryable: z.boolean(),
    order_id: orderIdSchema.nullable(),
    order_number: orderNumberSchema.nullable(),
    status: orderStatusSchema.nullable(),
    created_at: timestampSchema.nullable(),
    placed_at: timestampSchema.nullable(),
    vendor_decided_at: timestampSchema.nullable(),
    business_id: orderIdSchema.nullable(),
    vendor_name: orderSnapshotTextSchema.nullable(),
    market_slug: marketSlugSchema.nullable(),
    listing_id: orderIdSchema.nullable(),
    listing_route: listingRouteSchema.nullable(),
    listing_title: orderSnapshotTextSchema.nullable(),
    quantity: orderQuantitySchema.nullable(),
    currency_code: currencyCodeSchema.nullable(),
    unit_price_minor: positiveMinorAmountSchema.nullable(),
    total_minor: positiveMinorAmountSchema.nullable(),
    fulfilment_id: orderIdSchema.nullable(),
    fulfilment_status: z.literal("processing").nullable(),
    fulfilment_started_at: timestampSchema.nullable(),
    fulfilment_updated_at: timestampSchema.nullable(),
  })
  .strict();

const vendorOrderResponseWireSchema = z
  .object({
    outcome: vendorOrderResponseOutcomeSchema,
    retryable: z.boolean(),
    order_id: orderIdSchema.nullable(),
    status: listingOrderReadStatusSchema.nullable(),
    vendor_decided_at: timestampSchema.nullable(),
    updated_at: timestampSchema.nullable(),
  })
  .strict();

function hasExactTotal(
  quantity: number,
  unitPriceMinor: number,
  totalMinor: number,
) {
  return (
    Number.isSafeInteger(quantity * unitPriceMinor) &&
    quantity * unitPriceMinor === totalMinor
  );
}

function orderFromWire(
  row: z.infer<typeof orderWireSchema>,
): ListingOrderRecord | null {
  if (!hasExactTotal(row.quantity, row.unit_price_minor, row.total_minor))
    return null;
  if (
    (row.status === "placed" && row.vendor_decided_at !== null) ||
    (row.status !== "placed" && row.vendor_decided_at === null) ||
    (row.vendor_decided_at !== null &&
      Date.parse(row.vendor_decided_at) < Date.parse(row.placed_at))
  ) {
    return null;
  }
  const fulfilmentValues = [
    row.fulfilment_id,
    row.fulfilment_status,
    row.fulfilment_started_at,
    row.fulfilment_updated_at,
  ];
  const hasAnyFulfilment = fulfilmentValues.some((item) => item !== null);
  let fulfilment: OrderFulfilment | null = null;
  if (hasAnyFulfilment) {
    if (
      row.status !== "confirmed" ||
      row.vendor_decided_at === null ||
      row.fulfilment_id === null ||
      row.fulfilment_status === null ||
      row.fulfilment_started_at === null ||
      row.fulfilment_updated_at === null ||
      row.fulfilment_started_at !== row.fulfilment_updated_at ||
      Date.parse(row.fulfilment_started_at) < Date.parse(row.vendor_decided_at)
    ) {
      return null;
    }
    fulfilment = {
      id: row.fulfilment_id,
      status: row.fulfilment_status,
      startedAt: row.fulfilment_started_at,
      updatedAt: row.fulfilment_updated_at,
    };
  }
  return {
    id: row.order_id,
    orderNumber: row.order_number,
    status: row.status,
    createdAt: row.created_at,
    placedAt: row.placed_at,
    vendorDecidedAt: row.vendor_decided_at,
    businessId: row.business_id,
    vendorName: row.vendor_name,
    marketSlug: row.market_slug,
    listingId: row.listing_id,
    listingRoute: row.listing_route,
    listingTitle: row.listing_title,
    quantity: row.quantity,
    currencyCode: row.currency_code,
    unitPriceMinor: row.unit_price_minor,
    totalMinor: row.total_minor,
    fulfilment,
  };
}

export function parseListingOrderIntentCapability(
  value: unknown,
): ListingOrderIntentCapability | null {
  const parsed = capabilityWireSchema.safeParse(value);
  return parsed.success
    ? {
        id: parsed.data.id,
        secret: parsed.data.secret,
        expiresAt: parsed.data.expires_at,
      }
    : null;
}

export function parseListingOrderIntentContext(
  value: unknown,
): ListingOrderIntentContext | null {
  const parsed = intentWireSchema.safeParse(value);
  if (!parsed.success) return null;
  const row = parsed.data;
  if (!hasExactTotal(row.quantity, row.unit_price_minor, row.total_minor))
    return null;

  const existingValues = [
    row.order_id,
    row.order_number,
    row.order_status,
    row.order_created_at,
  ];
  const hasExistingOrder = existingValues.every((item) => item !== null);
  if (!hasExistingOrder && existingValues.some((item) => item !== null))
    return null;
  if ((row.consumed_at !== null) !== hasExistingOrder) return null;
  if (
    row.return_to !== `/${row.market_slug}/listings/${row.listing_route}/order`
  ) {
    return null;
  }

  return {
    id: row.intent_id,
    listingId: row.listing_id,
    businessId: row.business_id,
    marketId: row.market_id,
    quantity: row.quantity,
    returnTo: row.return_to,
    marketSlug: row.market_slug,
    listingRoute: row.listing_route,
    listingTitle: row.listing_title,
    vendorName: row.vendor_name,
    currencyCode: row.currency_code,
    unitPriceMinor: row.unit_price_minor,
    totalMinor: row.total_minor,
    claimedAt: row.claimed_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    existingOrderId: row.order_id ?? undefined,
    existingOrderNumber: row.order_number ?? undefined,
    existingOrderStatus: row.order_status ?? undefined,
    existingOrderCreatedAt: row.order_created_at ?? undefined,
  };
}

export function parseListingOrder(value: unknown): ListingOrderRecord | null {
  const parsed = orderWireSchema.safeParse(value);
  return parsed.success ? orderFromWire(parsed.data) : null;
}

export function parseListingOrderList(
  value: unknown,
): ListingOrderRecord[] | null {
  if (!Array.isArray(value) || value.length > ORDER_LIST_MAXIMUM) return null;
  const orders: ListingOrderRecord[] = [];
  for (const item of value) {
    const order = parseListingOrder(item);
    if (!order) return null;
    orders.push(order);
  }
  return orders;
}

export function parseOrderPlacementResponse(
  value: unknown,
): OrderPlacementResponse | null {
  const parsed = placementWireSchema.safeParse(value);
  if (!parsed.success) return null;
  const row = parsed.data;
  const orderValues = [
    row.order_id,
    row.order_number,
    row.status,
    row.created_at,
    row.placed_at,
    row.business_id,
    row.vendor_name,
    row.market_slug,
    row.listing_id,
    row.listing_route,
    row.listing_title,
    row.quantity,
    row.currency_code,
    row.unit_price_minor,
    row.total_minor,
  ];
  const hasCompleteOrder = orderValues.every((item) => item !== null);
  const hasAnyOrderValue = [
    ...orderValues,
    row.vendor_decided_at,
    row.fulfilment_id,
    row.fulfilment_status,
    row.fulfilment_started_at,
    row.fulfilment_updated_at,
  ].some((item) => item !== null);
  const success = row.outcome === "created" || row.outcome === "replayed";
  if (
    (success && !hasCompleteOrder) ||
    (!success && hasAnyOrderValue) ||
    row.retryable !== (row.outcome === "rate_limited")
  ) {
    return null;
  }

  if (!success)
    return { outcome: row.outcome, retryable: row.retryable, order: null };
  const order = parseListingOrder({
    order_id: row.order_id,
    order_number: row.order_number,
    status: row.status,
    created_at: row.created_at,
    placed_at: row.placed_at,
    vendor_decided_at: row.vendor_decided_at,
    business_id: row.business_id,
    vendor_name: row.vendor_name,
    market_slug: row.market_slug,
    listing_id: row.listing_id,
    listing_route: row.listing_route,
    listing_title: row.listing_title,
    quantity: row.quantity,
    currency_code: row.currency_code,
    unit_price_minor: row.unit_price_minor,
    total_minor: row.total_minor,
    fulfilment_id: row.fulfilment_id,
    fulfilment_status: row.fulfilment_status,
    fulfilment_started_at: row.fulfilment_started_at,
    fulfilment_updated_at: row.fulfilment_updated_at,
  });
  return order
    ? { outcome: row.outcome, retryable: row.retryable, order }
    : null;
}

/** Parses only the bounded, authoritative vendor-transition RPC projection. */
export function parseVendorOrderResponse(
  value: unknown,
): VendorOrderResponse | null {
  const parsed = vendorOrderResponseWireSchema.safeParse(value);
  if (!parsed.success) return null;

  const row = parsed.data;
  const success = row.outcome === "transitioned" || row.outcome === "replayed";
  const terminalOutcome =
    success ||
    row.outcome === "already_transitioned" ||
    row.outcome === "conflict";
  const hasCompleteTransition =
    row.order_id !== null &&
    row.status !== null &&
    row.vendor_decided_at !== null &&
    row.updated_at !== null;
  const hasAnyTransitionValue = [
    row.order_id,
    row.status,
    row.vendor_decided_at,
    row.updated_at,
  ].some((item) => item !== null);

  if (
    row.retryable !== (row.outcome === "rate_limited") ||
    (terminalOutcome && !hasCompleteTransition) ||
    (!terminalOutcome && hasAnyTransitionValue) ||
    (terminalOutcome && row.status === "placed") ||
    (terminalOutcome && row.vendor_decided_at !== row.updated_at)
  ) {
    return null;
  }

  return {
    outcome: row.outcome,
    retryable: row.retryable,
    orderId: row.order_id,
    status:
      row.status === "confirmed" || row.status === "cancelled"
        ? row.status
        : null,
    vendorDecidedAt: row.vendor_decided_at,
    updatedAt: row.updated_at,
  };
}

const orderFulfilmentResponseWireSchema = z
  .object({
    outcome: orderFulfilmentResponseOutcomeSchema,
    retryable: z.boolean(),
    order_id: orderIdSchema.nullable(),
    order_status: z.literal("confirmed").nullable(),
    fulfilment_id: orderIdSchema.nullable(),
    fulfilment_status: z.literal("processing").nullable(),
    fulfilment_started_at: timestampSchema.nullable(),
    fulfilment_updated_at: timestampSchema.nullable(),
  })
  .strict();

/** Parses only the bounded, authoritative fulfilment-start RPC projection. */
export function parseOrderFulfilmentResponse(
  value: unknown,
): OrderFulfilmentResponse | null {
  const parsed = orderFulfilmentResponseWireSchema.safeParse(value);
  if (!parsed.success) return null;

  const row = parsed.data;
  const success =
    row.outcome === "started" ||
    row.outcome === "replayed" ||
    row.outcome === "already_started";
  const fulfilmentValues = [
    row.order_id,
    row.order_status,
    row.fulfilment_id,
    row.fulfilment_status,
    row.fulfilment_started_at,
    row.fulfilment_updated_at,
  ];
  const hasCompleteFulfilment = fulfilmentValues.every((item) => item !== null);
  const hasAnyFulfilmentValue = fulfilmentValues.some((item) => item !== null);
  if (
    row.retryable !== (row.outcome === "rate_limited") ||
    (success && !hasCompleteFulfilment) ||
    (!success && hasAnyFulfilmentValue) ||
    (success && row.fulfilment_started_at !== row.fulfilment_updated_at)
  ) {
    return null;
  }

  return {
    outcome: row.outcome,
    retryable: row.retryable,
    orderId: row.order_id,
    orderStatus: row.order_status,
    fulfilmentId: row.fulfilment_id,
    fulfilmentStatus: row.fulfilment_status,
    fulfilmentStartedAt: row.fulfilment_started_at,
    fulfilmentUpdatedAt: row.fulfilment_updated_at,
  };
}
