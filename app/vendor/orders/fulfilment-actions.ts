"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  orderFulfilmentIdempotencyKeySchema,
  type OrderFulfilmentResponse,
} from "@/lib/orders/contract";
import { startListingOrderFulfilment } from "@/lib/orders/rpc";
import { getServerSupabaseClient } from "@/lib/supabase/server";

const orderFulfilmentInputSchema = z
  .object({
    orderId: z.string().uuid(),
    idempotencyKey: orderFulfilmentIdempotencyKeySchema,
  })
  .strict();

type FulfilmentFailureCode =
  | "configuration"
  | "unauthorized"
  | "validation"
  | "unavailable"
  | "malformed_response"
  | "idempotency_key_reused"
  | "not_found"
  | "invalid"
  | "rate_limited";

export type VendorOrderFulfilmentActionResult =
  | {
      ok: true;
      code: "started" | "replayed" | "already_started";
      message: string;
      retryable: false;
      status: "processing";
    }
  | {
      ok: false;
      code: FulfilmentFailureCode;
      message: string;
      retryable: boolean;
    };

function singleFormValue(formData: FormData, key: string): string | null {
  const values = formData.getAll(key);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}

function inputFromFormData(formData: FormData) {
  return orderFulfilmentInputSchema.safeParse({
    orderId: singleFormValue(formData, "order_id"),
    idempotencyKey: singleFormValue(formData, "idempotency_key"),
  });
}

function failure(
  code: FulfilmentFailureCode,
  message: string,
  retryable: boolean,
): VendorOrderFulfilmentActionResult {
  return { ok: false, code, message, retryable };
}

function resultForResponse(
  response: OrderFulfilmentResponse,
  orderId: string,
): VendorOrderFulfilmentActionResult {
  if (response.orderId !== null && response.orderId !== orderId) {
    return failure(
      "malformed_response",
      "We could not confirm fulfilment processing. Try again in a moment.",
      true,
    );
  }

  if (
    (response.outcome === "started" ||
      response.outcome === "replayed" ||
      response.outcome === "already_started") &&
    response.orderStatus === "confirmed" &&
    response.fulfilmentStatus === "processing" &&
    response.fulfilmentStartedAt === response.fulfilmentUpdatedAt
  ) {
    return {
      ok: true,
      code: response.outcome,
      status: "processing",
      retryable: false,
      message:
        "Vendor is processing your order. The vendor has recorded that they have begun handling it. LocalHub has not collected payment. Pickup, delivery, handoff, and completion are not yet recorded.",
    };
  }

  switch (response.outcome) {
    case "idempotency_key_reused":
    case "not_found":
    case "invalid":
      return failure(
        response.outcome,
        "We could not start fulfilment processing. Refresh the order before trying again.",
        false,
      );
    case "rate_limited":
      return failure(
        "rate_limited",
        "Too many fulfilment attempts were made. Wait before trying again with the same action.",
        true,
      );
    case "started":
    case "replayed":
    case "already_started":
      return failure(
        "malformed_response",
        "We could not confirm fulfilment processing. Try again in a moment.",
        true,
      );
  }
}

function revalidateOrderViews() {
  revalidatePath("/vendor/orders");
  revalidatePath("/vendor/orders/[order]", "page");
  revalidatePath("/[market]/orders", "page");
  revalidatePath("/[market]/orders/[order]", "page");
}

/** The form is untrusted; the RPC repeats authorization and mutation checks. */
export async function startVendorOrderFulfilment(
  _previousState: VendorOrderFulfilmentActionResult | null,
  formData: FormData,
): Promise<VendorOrderFulfilmentActionResult> {
  const input = inputFromFormData(formData);
  if (!input.success) {
    return failure(
      "validation",
      "We could not verify this fulfilment action. Refresh the order and try again.",
      false,
    );
  }

  const client = await getServerSupabaseClient().catch(() => null);
  if (!client) {
    return failure(
      "configuration",
      "Fulfilment processing is not available in this environment.",
      false,
    );
  }

  try {
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) {
      return failure(
        "unauthorized",
        "Your session has expired. Sign in again to process orders.",
        false,
      );
    }
  } catch {
    return failure(
      "unauthorized",
      "Your session could not be verified. Sign in again to process orders.",
      false,
    );
  }

  try {
    const result = await startListingOrderFulfilment(client, input.data);
    if (result.error || !result.response) {
      return failure(
        "unavailable",
        "We could not start fulfilment processing. Try again with the same action.",
        true,
      );
    }

    const actionResult = resultForResponse(result.response, input.data.orderId);
    if (actionResult.ok) revalidateOrderViews();
    return actionResult;
  } catch {
    return failure(
      "unavailable",
      "We could not start fulfilment processing. Try again with the same action.",
      true,
    );
  }
}
