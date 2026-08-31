import { authorizeListingMedia } from "@/lib/media/authorization";
import {
  createCanonicalMediaPath,
  LISTING_MEDIA_BUCKET,
  mediaNegotiationSchema,
} from "@/lib/media/contracts";
import {
  isTrustedMediaMutation,
  getSafeRequestId,
  readBoundedJsonBody,
} from "@/lib/media/request-security";
import {
  logMediaFailure,
  mediaErrorResponse,
  mediaSuccessResponse,
} from "@/lib/media/route-response";
import {
  cancelMediaUploadReservation,
  reserveMediaUpload,
} from "@/lib/media/upload-governance";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIGNED_UPLOAD_TOKEN_TTL_MS = 2 * 60 * 60 * 1_000;

export async function POST(request: Request) {
  const requestId = getSafeRequestId(request);
  if (!isTrustedMediaMutation(request)) {
    logMediaFailure(requestId, "invalid_request");
    return mediaErrorResponse(
      requestId,
      403,
      "MEDIA_INVALID_REQUEST",
      "We could not prepare that upload.",
      false,
    );
  }

  const parsed = mediaNegotiationSchema.safeParse(
    await readBoundedJsonBody(request),
  );
  if (!parsed.success) {
    logMediaFailure(requestId, "invalid_request");
    return mediaErrorResponse(
      requestId,
      400,
      "MEDIA_INVALID_REQUEST",
      "Check the selected file and try again.",
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

  let reservedUpload: { listingId: string; storagePath: string } | null = null;
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
          ? "Sign in before uploading listing media."
          : "This listing is not available for media changes.",
        false,
      );
    }

    const storagePath = createCanonicalMediaPath(parsed.data);
    const reservationInput = {
      listingId: parsed.data.listingId,
      storagePath,
    };
    const reservation = await reserveMediaUpload(client, reservationInput);
    if (!reservation.ok) {
      logMediaFailure(requestId, "reservation_failed");
      return mediaErrorResponse(
        requestId,
        503,
        "MEDIA_UPLOAD_RESERVATION_UNAVAILABLE",
        "A protected upload reservation could not be prepared.",
        true,
      );
    }
    reservedUpload = reservationInput;

    // Supabase signed upload tokens currently last two hours. Capture the
    // request start so the client receives a conservative token deadline,
    // while the database reservation keeps a separate cleanup safety buffer.
    const signedUploadRequestedAt = Date.now();
    const { data, error } = await client.storage
      .from(LISTING_MEDIA_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false });

    if (error || !data) {
      await cancelMediaUploadReservation(client, reservationInput);
      reservedUpload = null;
      logMediaFailure(requestId, "negotiation_failed");
      return mediaErrorResponse(
        requestId,
        503,
        "MEDIA_UPLOAD_NEGOTIATION_FAILED",
        "A secure upload target could not be prepared. Try again shortly.",
        true,
      );
    }

    return mediaSuccessResponse(requestId, {
      ok: true,
      bucket: LISTING_MEDIA_BUCKET,
      storagePath,
      uploadToken: data.token,
      expiresAt: new Date(
        signedUploadRequestedAt + SIGNED_UPLOAD_TOKEN_TTL_MS,
      ).toISOString(),
    });
  } catch {
    if (reservedUpload) {
      await cancelMediaUploadReservation(client, reservedUpload);
    }
    logMediaFailure(requestId, "negotiation_failed");
    return mediaErrorResponse(
      requestId,
      503,
      "MEDIA_UPLOAD_NEGOTIATION_FAILED",
      "A secure upload target could not be prepared. Try again shortly.",
      true,
    );
  }
}
