import { NextResponse } from "next/server";

import type { MediaMutationError } from "@/lib/media/contracts";

export type MediaErrorCode =
  | "MEDIA_AUTHENTICATION_REQUIRED"
  | "MEDIA_INVALID_REQUEST"
  | "MEDIA_LISTING_ACCESS_DENIED"
  | "MEDIA_OBJECT_INVALID"
  | "MEDIA_OBJECT_NOT_FOUND"
  | "MEDIA_PROVIDER_NOT_CONFIGURED"
  | "MEDIA_REMOVE_FAILED"
  | "MEDIA_STORAGE_CONFIRMATION_UNAVAILABLE"
  | "MEDIA_STORAGE_REGISTRATION_FAILED"
  | "MEDIA_UPLOAD_RESERVATION_REQUIRED"
  | "MEDIA_UPLOAD_RESERVATION_UNAVAILABLE"
  | "MEDIA_UPLOAD_NEGOTIATION_FAILED";

export function mediaErrorResponse(
  requestId: string,
  status: number,
  code: MediaErrorCode,
  message: string,
  retryable: boolean,
) {
  const body: MediaMutationError = { ok: false, code, message, retryable };
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}

export function mediaSuccessResponse(
  requestId: string,
  body: Record<string, unknown>,
  status = 200,
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}

export function logMediaFailure(
  requestId: string,
  event:
    | "authorization_failed"
    | "confirmation_failed"
    | "invalid_request"
    | "negotiation_failed"
    | "registration_failed"
    | "reservation_failed"
    | "removal_failed",
): void {
  // Only stable event codes and a safe request ID enter logs. Never log upload
  // tokens, cookies, file names, storage paths, request bodies, or provider errors.
  console.warn("[localhub-media]", { event, requestId });
}
