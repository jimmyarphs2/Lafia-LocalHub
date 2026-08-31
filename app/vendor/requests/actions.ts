"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  vendorDecisionIdempotencyKeySchema,
  vendorRequestDecisionSchema,
  type VendorRequestResponse,
} from "@/lib/requests/contract";
import { respondToListingRequest } from "@/lib/requests/rpc";
import { getServerSupabaseClient } from "@/lib/supabase/server";

const vendorRequestDecisionInputSchema = z
  .object({
    requestId: z.string().uuid(),
    decision: vendorRequestDecisionSchema,
    idempotencyKey: vendorDecisionIdempotencyKeySchema,
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

export type VendorRequestDecisionActionResult =
  | {
      ok: true;
      code: "transitioned" | "replayed";
      message: string;
      retryable: false;
      status: "accepted" | "declined";
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
  return vendorRequestDecisionInputSchema.safeParse({
    requestId: singleFormValue(formData, "request_id"),
    decision: singleFormValue(formData, "decision"),
    idempotencyKey: singleFormValue(formData, "idempotency_key"),
  });
}

function failure(
  code: DecisionFailureCode,
  message: string,
  retryable: boolean,
): VendorRequestDecisionActionResult {
  return { ok: false, code, message, retryable };
}

function resultForResponse(
  response: VendorRequestResponse,
  decision: "accept" | "decline",
): VendorRequestDecisionActionResult {
  const expectedStatus = decision === "accept" ? "accepted" : "declined";
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
        "Vendor response saved. This starts follow-up only; no booking, order, or payment was created.",
    };
  }

  switch (response.outcome) {
    case "already_transitioned":
    case "conflict":
      return failure(
        response.outcome,
        "This request has already been handled. Refresh the inbox to see its current follow-up status.",
        false,
      );
    case "not_found":
    case "invalid":
    case "idempotency_key_reused":
      return failure(
        response.outcome,
        "This vendor response could not be completed. Refresh the inbox before trying again.",
        false,
      );
    case "rate_limited":
      return failure(
        response.outcome,
        "Too many vendor responses were attempted. Wait before trying again with the same decision.",
        true,
      );
    case "transitioned":
    case "replayed":
      return failure(
        "malformed_response",
        "We could not confirm this vendor response. Try again in a moment.",
        true,
      );
  }
}

function revalidateRequestViews() {
  revalidatePath("/vendor/requests");
  revalidatePath("/[market]/requests", "page");
  revalidatePath("/[market]/requests/[request]", "page");
}

/**
 * The rendered form is not a security boundary: every field is parsed again,
 * authentication is verified, and the database RPC performs authorization.
 */
export async function respondToVendorRequest(
  _previousState: VendorRequestDecisionActionResult | null,
  formData: FormData,
): Promise<VendorRequestDecisionActionResult> {
  const input = inputFromFormData(formData);
  if (!input.success) {
    return failure(
      "validation",
      "We could not verify this vendor response. Refresh the inbox and try again.",
      false,
    );
  }

  const client = await getServerSupabaseClient().catch(() => null);
  if (!client) {
    return failure(
      "configuration",
      "Vendor responses are not available in this environment.",
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
        "Your session has expired. Sign in again to respond to requests.",
        false,
      );
    }
  } catch {
    return failure(
      "unauthorized",
      "Your session could not be verified. Sign in again to respond to requests.",
      false,
    );
  }

  try {
    const result = await respondToListingRequest(client, input.data);
    if (result.error || !result.response) {
      return failure(
        "unavailable",
        "We could not save this vendor response. Try again with the same decision.",
        true,
      );
    }

    // Revalidate only after an authoritative, fully parsed row is returned.
    if (result.response.requestId) revalidateRequestViews();
    return resultForResponse(result.response, input.data.decision);
  } catch {
    return failure(
      "unavailable",
      "We could not save this vendor response. Try again with the same decision.",
      true,
    );
  }
}
