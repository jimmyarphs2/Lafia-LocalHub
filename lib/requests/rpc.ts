import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parseListingRequest,
  parseListingRequestList,
  parseRequestIntentContext,
  parseVendorRequestResponse,
  type ListingRequestIntentContext,
  type ListingRequestRecord,
  type VendorRequestResponse,
} from "@/lib/requests/contract";
import type { Database } from "@/lib/supabase/database.types";

type RequestClient = SupabaseClient<Database>;

function contractError() {
  return new Error(
    "Request RPC response did not match its generated contract.",
  );
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

export async function createListingRequestIntent(
  client: RequestClient,
  input: {
    listingId: string;
    requestedAction: string;
    searchContext: string | null;
    rateLimitKey: string;
  },
) {
  return client.rpc("create_listing_request_intent", {
    p_listing_id: input.listingId,
    p_requested_action: input.requestedAction,
    p_search_context: input.searchContext,
    p_rate_limit_key: input.rateLimitKey,
  });
}

export async function getListingRequestIntent(
  client: RequestClient,
  intentId: string,
): Promise<{ context: ListingRequestIntentContext | null; error: unknown }> {
  const result = await client.rpc("get_listing_request_intent", {
    p_intent_id: intentId,
  });
  const singleton = optionalRpcRow(result.data as unknown);
  const context =
    result.error || singleton.row === null
      ? null
      : parseRequestIntentContext(singleton.row);
  return {
    context,
    error:
      result.error ??
      (singleton.malformed || (singleton.row !== null && !context)
        ? contractError()
        : null),
  };
}

export async function createListingRequestFromIntent(
  client: RequestClient,
  intentId: string,
  details: string | null,
): Promise<{ request: ListingRequestRecord | null; error: unknown }> {
  const result = await client.rpc("create_listing_request_from_intent", {
    p_intent_id: intentId,
    p_details: details,
  });
  const request = result.error
    ? null
    : parseListingRequest(singleRpcRow(result.data as unknown));
  return { request, error: result.error ?? (request ? null : contractError()) };
}

export async function listCustomerListingRequests(
  client: RequestClient,
  marketSlug: string,
): Promise<{ requests: ListingRequestRecord[]; error: unknown }> {
  const result = await client.rpc("list_customer_listing_requests", {
    p_market_slug: marketSlug,
  });
  const requests = result.error
    ? null
    : parseListingRequestList(result.data as unknown);
  return {
    requests: requests ?? [],
    error: result.error ?? (requests ? null : contractError()),
  };
}

export async function getCustomerListingRequest(
  client: RequestClient,
  requestId: string,
): Promise<{ request: ListingRequestRecord | null; error: unknown }> {
  const result = await client.rpc("get_customer_listing_request", {
    p_request_id: requestId,
  });
  const singleton = optionalRpcRow(result.data as unknown);
  const request =
    result.error || singleton.row === null
      ? null
      : parseListingRequest(singleton.row);
  return {
    request,
    error:
      result.error ??
      (singleton.malformed || (singleton.row !== null && !request)
        ? contractError()
        : null),
  };
}

export async function listVendorListingRequests(
  client: RequestClient,
): Promise<{ requests: ListingRequestRecord[]; error: unknown }> {
  const result = await client.rpc("list_vendor_listing_requests");
  const requests = result.error
    ? null
    : parseListingRequestList(result.data as unknown);
  return {
    requests: requests ?? [],
    error: result.error ?? (requests ? null : contractError()),
  };
}

/** Calls only the vendor-owned transition RPC and returns its safe projection. */
export async function respondToListingRequest(
  client: RequestClient,
  input: {
    requestId: string;
    decision: "accept" | "decline";
    idempotencyKey: string;
  },
): Promise<{ response: VendorRequestResponse | null; error: unknown }> {
  const result = await client.rpc("respond_to_listing_request", {
    p_request_id: input.requestId,
    p_decision: input.decision,
    p_idempotency_key: input.idempotencyKey,
  });
  // PostgREST represents a `RETURNS TABLE` RPC as an array. Enforce exactly
  // one row here, then let the strict row parser reject any malformed value.
  const responseRow = singleRpcRow(result.data as unknown);
  const response = result.error
    ? null
    : parseVendorRequestResponse(responseRow);
  return {
    response,
    error: result.error ?? (response ? null : contractError()),
  };
}
