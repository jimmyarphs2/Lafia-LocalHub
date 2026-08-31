import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type MediaUploadReservationResult =
  { ok: true; expiresAt: string } | { ok: false };

export type MediaUploadConfirmationResult =
  "confirmed" | "rejected" | "unavailable";

export type MediaUploadCancellationResult =
  "cancelled" | "not_reserved" | "unavailable";

export type MediaUploadRemovalResult =
  "not_confirmed" | "removed" | "unavailable";

/**
 * Atomically consumes the auth.uid-derived quota and creates or reuses the
 * actor-bound canonical-path reservation. No separate quota RPC is callable.
 */
export async function reserveMediaUpload(
  client: SupabaseClient,
  input: { listingId: string; storagePath: string },
): Promise<MediaUploadReservationResult> {
  try {
    const { data, error } = await client.rpc("reserve_listing_media_upload", {
      p_listing_id: input.listingId,
      p_storage_path: input.storagePath,
    });
    if (error || typeof data !== "string") return { ok: false };

    const expiresAt = new Date(data);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
      return { ok: false };
    }
    return { ok: true, expiresAt: expiresAt.toISOString() };
  } catch {
    return { ok: false };
  }
}

/** Marks a reservation confirmed only after object and listing checks pass. */
export async function confirmMediaUploadReservation(
  client: SupabaseClient,
  input: { listingId: string; storagePath: string },
): Promise<MediaUploadConfirmationResult> {
  try {
    const { data, error } = await client.rpc("confirm_listing_media_upload", {
      p_listing_id: input.listingId,
      p_storage_path: input.storagePath,
    });
    if (error) return "unavailable";
    if (data === true) return "confirmed";
    if (data === false) return "rejected";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Cancels an outstanding reservation after exact-path object removal. */
export async function cancelMediaUploadReservation(
  client: SupabaseClient,
  input: { listingId: string; storagePath: string },
): Promise<MediaUploadCancellationResult> {
  try {
    const { data, error } = await client.rpc("cancel_listing_media_upload", {
      p_listing_id: input.listingId,
      p_storage_path: input.storagePath,
    });
    if (error) return "unavailable";
    if (data === true) return "cancelled";
    if (data === false) return "not_reserved";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Records confirmed-media removal after object and metadata deletion. */
export async function markMediaUploadRemoved(
  client: SupabaseClient,
  input: { listingId: string; storagePath: string },
): Promise<MediaUploadRemovalResult> {
  try {
    const { data, error } = await client.rpc(
      "mark_listing_media_upload_removed",
      {
        p_listing_id: input.listingId,
        p_storage_path: input.storagePath,
      },
    );
    if (error) return "unavailable";
    if (data === true) return "removed";
    if (data === false) return "not_confirmed";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}
