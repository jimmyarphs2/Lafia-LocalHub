import { authorizeListingMedia } from "@/lib/media/authorization";
import {
  LISTING_MEDIA_BUCKET,
  mediaRemovalSchema,
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
import {
  cancelMediaUploadReservation,
  markMediaUploadRemoved,
} from "@/lib/media/upload-governance";
import { getServerAdminSupabaseClient } from "@/lib/supabase/admin";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(request: Request) {
  const requestId = getSafeRequestId(request);
  if (!isTrustedMediaMutation(request)) {
    logMediaFailure(requestId, "invalid_request");
    return mediaErrorResponse(
      requestId,
      403,
      "MEDIA_INVALID_REQUEST",
      "We could not remove that upload.",
      false,
    );
  }

  const parsed = mediaRemovalSchema.safeParse(
    await readBoundedJsonBody(request),
  );
  if (!parsed.success) {
    logMediaFailure(requestId, "invalid_request");
    return mediaErrorResponse(
      requestId,
      400,
      "MEDIA_INVALID_REQUEST",
      "The removal request did not match this upload.",
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
      "cleanup",
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
          ? "Sign in before removing listing media."
          : "This listing is not available for media changes.",
        false,
      );
    }

    // The admin client mutates only the exact object and metadata row after
    // user-scoped manager authorization and canonical-path validation succeed.
    const adminClient = getServerAdminSupabaseClient();
    if (!adminClient) {
      logMediaFailure(requestId, "removal_failed");
      return mediaErrorResponse(
        requestId,
        503,
        "MEDIA_REMOVE_FAILED",
        "Secure removal is temporarily unavailable.",
        true,
      );
    }

    const storageRemoval = await adminClient.storage
      .from(LISTING_MEDIA_BUCKET)
      .remove([parsed.data.storagePath]);
    if (storageRemoval.error) {
      logMediaFailure(requestId, "removal_failed");
      return mediaErrorResponse(
        requestId,
        503,
        "MEDIA_REMOVE_FAILED",
        "The upload could not be removed safely. Try again shortly.",
        true,
      );
    }

    const metadataRemoval = await adminClient
      .from("listing_media")
      .delete()
      .eq("listing_id", parsed.data.listingId)
      .eq("storage_path", parsed.data.storagePath);
    if (metadataRemoval.error) {
      logMediaFailure(requestId, "removal_failed");
      return mediaErrorResponse(
        requestId,
        503,
        "MEDIA_REMOVE_FAILED",
        "The original was removed, but cleanup is still pending. Retry safely.",
        true,
      );
    }

    const lifecycleInput = {
      listingId: parsed.data.listingId,
      storagePath: parsed.data.storagePath,
    };
    const removal = await markMediaUploadRemoved(client, lifecycleInput);
    if (removal === "removed") {
      return mediaSuccessResponse(requestId, { ok: true, removed: true });
    }

    if (removal === "not_confirmed") {
      const cancellation = await cancelMediaUploadReservation(
        client,
        lifecycleInput,
      );
      if (cancellation === "cancelled") {
        return mediaSuccessResponse(requestId, { ok: true, removed: true });
      }
    }

    logMediaFailure(requestId, "reservation_failed");
    return mediaErrorResponse(
      requestId,
      503,
      "MEDIA_REMOVE_FAILED",
      "The original was removed, but protected cleanup is still pending. Retry safely.",
      true,
    );
  } catch {
    logMediaFailure(requestId, "removal_failed");
    return mediaErrorResponse(
      requestId,
      503,
      "MEDIA_REMOVE_FAILED",
      "The upload could not be removed safely. Try again shortly.",
      true,
    );
  }
}
