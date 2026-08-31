"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  vendorOrderDecisionIdempotencyKeySchema,
  vendorOrderDecisionSchema,
  type VendorOrderResponse,
} from "@/lib/orders/contract";
import { respondToListingOrder } from "@/lib/orders/rpc";
import { getServerSupabaseClient } from "@/lib/supabase/server";

const vendorOrderDecisionInputSchema = z
  .object({
    orderId: z.string().uuid(),
    decision: vendorOrderDecisionSchema,
    idempotencyKey: vendorOrderDecisionIdempotencyKeySchema,
  })
  .strict();

type DecisionFailureCode =
  | "configuration"
  | "unauthorized"
  | "validation"
  | "unavailable"
  | "malformed_response"
  | "already_transitioned"
  | "conflict"
  | "not_found"
  | "invalid"
  | "idempotency_key_reused"
  | "rate_limited";

export type VendorOrderDecisionActionResult =
  | {
      ok: true;
      code: "transitioned" | "replayed";
      message: string;
      retryable: false;
      status: "confirmed" | "cancelled";
    }
  | {
      ok: false;
      code: DecisionFailureCode;
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
  return vendorOrderDecisionInputSchema.safeParse({
    orderId: singleFormValue(formData, "order_id"),
    decision: singleFormValue(formData, "decision"),
    idempotencyKey: singleFormValue(formData, "idempotency_key"),
  });
}

function failure(
  code: DecisionFailureCode,
  message: string,
  retryable: boolean,
): VendorOrderDecisionActionResult {
  return { ok: false, code, message, retryable };
}

function resultForResponse(
  response: VendorOrderResponse,
  decision: "confirm" | "cancel",
  orderId: string,
): VendorOrderDecisionActionResult {
  if (response.orderId !== null && response.orderId !== orderId) {
    return failure(
      "malformed_response",
      "We could not confirm this vendor decision. Try again in a moment.",
      true,
    );
  }

  const expectedStatus = decision === "confirm" ? "confirmed" : "cancelled";
  if (
    (response.outcome === "transitioned" || response.outcome === "replayed") &&
    response.status === expectedStatus
  ) {
    return {
      ok: true,
      code: response.outcome,
      status: response.status,
      retryable: false,
      message:
        response.status === "confirmed"
          ? "Vendor availability has been recorded. No payment has been collected and fulfilment has not started."
          : "This order was cancelled before payment. No refund is required and fulfilment has not started.",
    };
  }

  switch (response.outcome) {
    case "already_transitioned":
    case "conflict":
      return failure(
        response.outcome,
        "This order has already been handled. Refresh the inbox to see its current status.",
        false,
      );
    case "not_found":
    case "invalid":
    case "idempotency_key_reused":
      return failure(
        response.outcome,
        "This vendor decision could not be completed. Refresh the inbox before trying again.",
        false,
      );
    case "rate_limited":
      return failure(
        "rate_limited",
        "Too many vendor decisions were attempted. Wait before trying again with the same decision.",
        true,
      );
    case "transitioned":
    case "replayed":
      return failure(
        "malformed_response",
        "We could not confirm this vendor decision. Try again in a moment.",
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

/**
 * The rendered form is not a security boundary: exact input fields are parsed
 * again, the actor is authenticated, and the RPC repeats authorization.
 */
export async function respondToVendorOrder(
  _previousState: VendorOrderDecisionActionResult | null,
  formData: FormData,
): Promise<VendorOrderDecisionActionResult> {
  const input = inputFromFormData(formData);
  if (!input.success) {
    return failure(
      "validation",
      "We could not verify this vendor decision. Refresh the order and try again.",
      false,
    );
  }

  const client = await getServerSupabaseClient().catch(() => null);
  if (!client) {
    return failure(
      "configuration",
      "Vendor order decisions are not available in this environment.",
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
        "Your session has expired. Sign in again to respond to orders.",
        false,
      );
    }
  } catch {
    return failure(
      "unauthorized",
      "Your session could not be verified. Sign in again to respond to orders.",
      false,
    );
  }

  try {
    const result = await respondToListingOrder(client, input.data);
    if (result.error || !result.response) {
      return failure(
        "unavailable",
        "We could not save this vendor decision. Try again with the same decision.",
        true,
      );
    }

    const actionResult = resultForResponse(
      result.response,
      input.data.decision,
      input.data.orderId,
    );
    if (actionResult.ok) revalidateOrderViews();
    return actionResult;
  } catch {
    return failure(
      "unavailable",
      "We could not save this vendor decision. Try again with the same decision.",
      true,
    );
  }
}
