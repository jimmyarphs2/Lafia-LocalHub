import { authorizeListingMedia } from "@/lib/media/authorization";
import {
  getListingMediaKind,
  LISTING_MEDIA_BUCKET,
  LISTING_MEDIA_REGISTRATION_OPTIONS,
  mediaConfirmationSchema,
} from "@/lib/media/contracts";
import {
  getSafeRequestId,
  isTrustedMediaMutation,
  readBoundedJsonBody,
} from "@/lib/media/request-security";
import {
  logMediaFailure,
  mediaErrorResponse,
  mediaSuccessResponse,
} from "@/lib/media/route-response";
import { confirmMediaUploadReservation } from "@/lib/media/upload-governance";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizedContentType(value: string | undefined): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  return (
    candidate.status === 404 ||
    candidate.statusCode === "404" ||
    candidate.code === "NoSuchKey" ||
    candidate.code === "not_found"
  );
}

export async function POST(request: Request) {
  const requestId = getSafeRequestId(request);
  if (!isTrustedMediaMutation(request)) {
    logMediaFailure(requestId, "invalid_request");
    return mediaErrorResponse(
      requestId,
      403,
      "MEDIA_INVALID_REQUEST",
      "We could not confirm that upload.",
      false,
    );
  }

  const parsed = mediaConfirmationSchema.safeParse(
    await readBoundedJsonBody(request),
  );
  if (!parsed.success) {
    logMediaFailure(requestId, "invalid_request");
    return mediaErrorResponse(
      requestId,
      400,
      "MEDIA_INVALID_REQUEST",
      "The upload confirmation did not match the selected file.",
      false,
    );
  }

  const client = await getServerSupabaseClient();
  if (!client) {
    return mediaErrorResponse(
      requestId,
      503,
      "MEDIA_PROVIDER_NOT_CONFIGURED",
      "Secure media storage is not configured in this environment.",
      true,
    );
  }

  try {
    const authorization = await authorizeListingMedia(
      client,
      parsed.data.listingId,
      "draft_upload",
    );
    if (!authorization.ok) {
      logMediaFailure(requestId, "authorization_failed");
      return mediaErrorResponse(
        requestId,
        authorization.reason === "authentication_required" ? 401 : 403,
        authorization.reason === "authentication_required"
          ? "MEDIA_AUTHENTICATION_REQUIRED"
          : "MEDIA_LISTING_ACCESS_DENIED",
        authorization.reason === "authentication_required"
          ? "Sign in before confirming listing media."
          : "This listing is not available for media changes.",
        false,
      );
    }

    const infoResult = await client.storage
      .from(LISTING_MEDIA_BUCKET)
      .info(parsed.data.storagePath);

    if (infoResult.error || !infoResult.data) {
      logMediaFailure(requestId, "confirmation_failed");
      const objectMissing = isNotFoundError(infoResult.error);
      return mediaErrorResponse(
        requestId,
        objectMissing ? 409 : 503,
        objectMissing
          ? "MEDIA_OBJECT_NOT_FOUND"
          : "MEDIA_STORAGE_CONFIRMATION_UNAVAILABLE",
        objectMissing
          ? "The upload has not reached secure storage yet."
          : "Secure storage could not verify the upload yet.",
        true,
      );
    }

    const storedMimeType = normalizedContentType(infoResult.data.contentType);
    const storedPathMatches = infoResult.data.name === parsed.data.storagePath;
    if (
      !storedPathMatches ||
      infoResult.data.size !== parsed.data.sizeBytes ||
      storedMimeType !== parsed.data.mimeType
    ) {
      logMediaFailure(requestId, "confirmation_failed");
      return mediaErrorResponse(
        requestId,
        422,
        "MEDIA_OBJECT_INVALID",
        "The stored file did not match the upload request. Remove it and try again.",
        false,
      );
    }

    const reservation = await confirmMediaUploadReservation(client, {
      listingId: parsed.data.listingId,
      storagePath: parsed.data.storagePath,
    });
    if (reservation !== "confirmed") {
      logMediaFailure(requestId, "reservation_failed");
      return mediaErrorResponse(
        requestId,
        reservation === "rejected" ? 409 : 503,
        reservation === "rejected"
          ? "MEDIA_UPLOAD_RESERVATION_REQUIRED"
          : "MEDIA_UPLOAD_RESERVATION_UNAVAILABLE",
        reservation === "rejected"
          ? "This upload no longer has a valid protected reservation."
          : "The protected upload reservation could not be confirmed yet.",
        reservation === "unavailable",
      );
    }

    const registration = await client.from("listing_media").upsert(
      {
        listing_id: parsed.data.listingId,
        storage_path: parsed.data.storagePath,
        media_type: getListingMediaKind(parsed.data.mimeType),
        alt_text: parsed.data.altText || null,
        sort_order: 0,
      },
      LISTING_MEDIA_REGISTRATION_OPTIONS,
    );

    if (registration.error) {
      logMediaFailure(requestId, "registration_failed");
      return mediaErrorResponse(
        requestId,
        503,
        "MEDIA_STORAGE_REGISTRATION_FAILED",
        "The original arrived, but its listing record could not be confirmed yet.",
        true,
      );
    }

    return mediaSuccessResponse(requestId, {
      ok: true,
      storagePath: parsed.data.storagePath,
      confirmed: true,
      enhanced: false,
      published: false,
      originalRetained: true,
    });
  } catch {
    logMediaFailure(requestId, "confirmation_failed");
    return mediaErrorResponse(
      requestId,
      503,
      "MEDIA_STORAGE_CONFIRMATION_UNAVAILABLE",
      "Secure storage could not verify the upload yet.",
      true,
    );
  }
}
