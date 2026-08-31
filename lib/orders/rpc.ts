import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parseListingOrder,
  parseListingOrderIntentCapability,
  parseListingOrderIntentContext,
  parseListingOrderList,
  parseOrderFulfilmentResponse,
  parseOrderPlacementResponse,
  parseVendorOrderResponse,
  type ListingOrderIntentCapability,
  type ListingOrderIntentContext,
  type ListingOrderRecord,
  type OrderPlacementResponse,
  type OrderFulfilmentResponse,
  type VendorOrderResponse,
} from "@/lib/orders/contract";
import type { Database } from "@/lib/supabase/database.types";

type OrderClient = SupabaseClient<Database>;

function contractError() {
  return new Error("Order RPC response did not match its generated contract.");
}

/** PostgREST represents `RETURNS TABLE` one-row RPCs as singleton arrays. */
function singleRpcRow(value: unknown): unknown | null {
  return Array.isArray(value) && value.length === 1 ? value[0] : null;
}

function optionalRpcRow(value: unknown): {
  malformed: boolean;
  row: unknown | null;
} {
  if (!Array.isArray(value) || value.length > 1) {
    return { malformed: true, row: null };
  }
  return { malformed: false, row: value[0] ?? null };
}

export async function createListingOrderIntent(
  client: OrderClient,
  input: { listingId: string; quantity: number; rateLimitKey: string },
): Promise<{
  capability: ListingOrderIntentCapability | null;
  error: unknown;
}> {
  const result = await client.rpc("create_listing_order_intent", {
    p_listing_id: input.listingId,
    p_quantity: input.quantity,
    p_rate_limit_key: input.rateLimitKey,
  });
  const capability = result.error
    ? null
    : parseListingOrderIntentCapability(singleRpcRow(result.data as unknown));
  return {
    capability,
    error: result.error ?? (capability ? null : contractError()),
  };
}

export async function getListingOrderIntent(
  client: OrderClient,
  intentId: string,
): Promise<{ context: ListingOrderIntentContext | null; error: unknown }> {
  const result = await client.rpc("get_listing_order_intent", {
    p_intent_id: intentId,
  });
  const singleton = optionalRpcRow(result.data as unknown);
  const context =
    result.error || singleton.row === null
      ? null
      : parseListingOrderIntentContext(singleton.row);
  return {
    context,
    error:
      result.error ??
      (singleton.malformed || (singleton.row !== null && !context)
        ? contractError()
        : null),
  };
}

export async function createListingOrderFromIntent(
  client: OrderClient,
  intentId: string,
): Promise<{ response: OrderPlacementResponse | null; error: unknown }> {
  const result = await client.rpc("create_listing_order_from_intent", {
    p_intent_id: intentId,
  });
  const response = result.error
    ? null
    : parseOrderPlacementResponse(singleRpcRow(result.data as unknown));
  return {
    response,
    error: result.error ?? (response ? null : contractError()),
  };
}

export async function listCustomerOrders(
  client: OrderClient,
  marketSlug: string,
): Promise<{ orders: ListingOrderRecord[]; error: unknown }> {
  const result = await client.rpc("list_customer_orders", {
    p_market_slug: marketSlug,
  });
  const orders = result.error
    ? null
    : parseListingOrderList(result.data as unknown);
  return {
    orders: orders ?? [],
    error: result.error ?? (orders ? null : contractError()),
  };
}

export async function getCustomerOrder(
  client: OrderClient,
  marketSlug: string,
  orderNumber: string,
): Promise<{ order: ListingOrderRecord | null; error: unknown }> {
  const result = await client.rpc("get_customer_order", {
    p_market_slug: marketSlug,
    p_order_number: orderNumber,
  });
  return optionalOrderResult(result.data as unknown, result.error);
}

export async function listVendorOrders(
  client: OrderClient,
): Promise<{ orders: ListingOrderRecord[]; error: unknown }> {
  const result = await client.rpc("list_vendor_orders");
  const orders = result.error
    ? null
    : parseListingOrderList(result.data as unknown);
  return {
    orders: orders ?? [],
    error: result.error ?? (orders ? null : contractError()),
  };
}

export async function getVendorOrder(
  client: OrderClient,
  orderNumber: string,
): Promise<{ order: ListingOrderRecord | null; error: unknown }> {
  const result = await client.rpc("get_vendor_order", {
    p_order_number: orderNumber,
  });
  return optionalOrderResult(result.data as unknown, result.error);
}

/** Calls only the vendor-owned order transition RPC and parses its safe DTO. */
export async function respondToListingOrder(
  client: OrderClient,
  input: {
    orderId: string;
    decision: "confirm" | "cancel";
    idempotencyKey: string;
  },
): Promise<{ response: VendorOrderResponse | null; error: unknown }> {
  const result = await client.rpc("respond_to_listing_order", {
    p_order_id: input.orderId,
    p_decision: input.decision,
    p_idempotency_key: input.idempotencyKey,
  });
  const response = result.error
    ? null
    : parseVendorOrderResponse(singleRpcRow(result.data));
  return {
    response,
    error: result.error ?? (response ? null : contractError()),
  };
}

/** Calls only the vendor-owned fulfilment-start RPC and parses its safe DTO. */
export async function startListingOrderFulfilment(
  client: OrderClient,
  input: {
    orderId: string;
    idempotencyKey: string;
  },
): Promise<{ response: OrderFulfilmentResponse | null; error: unknown }> {
  const result = await client.rpc("start_listing_order_fulfilment", {
    p_order_id: input.orderId,
    p_idempotency_key: input.idempotencyKey,
  });
  const response = result.error
    ? null
    : parseOrderFulfilmentResponse(singleRpcRow(result.data));
  return {
    response,
    error: result.error ?? (response ? null : contractError()),
  };
}

function optionalOrderResult(
  data: unknown,
  providerError: unknown,
): { order: ListingOrderRecord | null; error: unknown } {
  const singleton = optionalRpcRow(data);
  const order =
    providerError || singleton.row === null
      ? null
      : parseListingOrder(singleton.row);
  return {
    order,
    error:
      providerError ??
      (singleton.malformed || (singleton.row !== null && !order)
        ? contractError()
        : null),
  };
}
