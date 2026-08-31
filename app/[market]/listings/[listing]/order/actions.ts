"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { orderIntentIdSchema } from "@/lib/orders/contract";
import { createListingOrderFromIntent } from "@/lib/orders/rpc";
import { getServerSupabaseClient } from "@/lib/supabase/server";

type PlaceOrderFailureCode =
  | "configuration"
  | "unauthorized"
  | "validation"
  | "provider_unavailable"
  | "malformed_response"
  | "invalid"
  | "expired"
  | "unavailable"
  | "quote_changed"
  | "rate_limited";

export type PlaceOrderActionResult = {
  ok: false;
  code: PlaceOrderFailureCode;
  message: string;
  retryable: boolean;
};

function failure(
  code: PlaceOrderFailureCode,
  message: string,
  retryable: boolean,
): PlaceOrderActionResult {
  return { ok: false, code, message, retryable };
}

function singleFormValue(formData: FormData, key: string): string | null {
  const values = formData.getAll(key);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}

/** Server Actions are direct POST endpoints; the database remains the authorization boundary. */
export async function placeListingOrder(
  _previousState: PlaceOrderActionResult | null,
  formData: FormData,
): Promise<PlaceOrderActionResult> {
  const intentId = orderIntentIdSchema.safeParse(
    singleFormValue(formData, "intent_id"),
  );
  if (!intentId.success) {
    return failure(
      "validation",
      "We could not verify this order. Return to the listing and start again.",
      false,
    );
  }

  const client = await getServerSupabaseClient().catch(() => null);
  if (!client) {
    return failure(
      "configuration",
      "Order placement is not available in this environment.",
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
        "Your session has expired. Sign in again before placing this order.",
        false,
      );
    }
  } catch {
    return failure(
      "unauthorized",
      "Your session could not be verified. Sign in again before placing this order.",
      false,
    );
  }

  let destination: string | null = null;
  try {
    const result = await createListingOrderFromIntent(client, intentId.data);
    if (result.error || !result.response) {
      return failure(
        "provider_unavailable",
        "We could not place the order. Try again with the same confirmation.",
        true,
      );
    }

    const { response } = result;
    if (
      (response.outcome === "created" || response.outcome === "replayed") &&
      response.order
    ) {
      destination = `/${response.order.marketSlug}/orders/${response.order.orderNumber}`;
    } else {
      switch (response.outcome) {
        case "invalid":
          return failure(
            "invalid",
            "This order confirmation is no longer valid. Return to the listing and start again.",
            false,
          );
        case "expired":
          return failure(
            "expired",
            "This order confirmation has expired. Return to the listing and start again.",
            false,
          );
        case "unavailable":
          return failure(
            "unavailable",
            "This listing is no longer available for direct ordering.",
            false,
          );
        case "quote_changed":
          return failure(
            "quote_changed",
            "The listing price changed before placement. Return to the listing to review a new order.",
            false,
          );
        case "rate_limited":
          return failure(
            "rate_limited",
            "Too many order attempts were made. Wait before trying this same confirmation again.",
            true,
          );
        case "created":
        case "replayed":
          return failure(
            "malformed_response",
            "We could not confirm the saved order. Try again with the same confirmation.",
            true,
          );
      }
    }
  } catch {
    return failure(
      "provider_unavailable",
      "We could not place the order. Try again with the same confirmation.",
      true,
    );
  }

  if (!destination) {
    return failure(
      "malformed_response",
      "We could not confirm the saved order. Try again with the same confirmation.",
      true,
    );
  }
  revalidatePath("/[market]/orders", "page");
  revalidatePath("/[market]/orders/[order]", "page");
  revalidatePath("/vendor/orders");
  revalidatePath("/vendor/orders/[order]", "page");
  redirect(destination);
}
