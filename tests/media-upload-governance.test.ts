import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  cancelMediaUploadReservation,
  confirmMediaUploadReservation,
  markMediaUploadRemoved,
  reserveMediaUpload,
} from "@/lib/media/upload-governance";

function clientReturning(result: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
  } as unknown as SupabaseClient;
}

describe("durable media upload governance", () => {
  it("uses only the atomic reservation RPC for actor quota and path binding", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const client = clientReturning({ data: expiresAt, error: null });
    const input = {
      listingId: "5e5e77cd-45dc-4f36-9a1f-314cad75f5db",
      storagePath:
        "5e5e77cd-45dc-4f36-9a1f-314cad75f5db/26aa9e8f1f6c4eb2bb97e151f1c63e45.jpg",
    };

    await expect(reserveMediaUpload(client, input)).resolves.toEqual({
      ok: true,
      expiresAt,
    });
    expect(client.rpc).toHaveBeenCalledWith("reserve_listing_media_upload", {
      p_listing_id: input.listingId,
      p_storage_path: input.storagePath,
    });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).not.toHaveBeenCalledWith(
      "consume_media_upload_rate_limit",
    );
  });

  it("fails closed when atomic quota/reservation is unavailable or malformed", async () => {
    const unavailable = clientReturning({ data: null, error: new Error("db") });
    const malformed = clientReturning({ data: true, error: null });
    const input = {
      listingId: "5e5e77cd-45dc-4f36-9a1f-314cad75f5db",
      storagePath:
        "5e5e77cd-45dc-4f36-9a1f-314cad75f5db/26aa9e8f1f6c4eb2bb97e151f1c63e45.jpg",
    };

    await expect(reserveMediaUpload(unavailable, input)).resolves.toEqual({
      ok: false,
    });
    await expect(reserveMediaUpload(malformed, input)).resolves.toEqual({
      ok: false,
    });
  });

  it("requires an affirmative reservation confirmation result", async () => {
    const client = clientReturning({ data: false, error: null });
    const input = {
      listingId: "5e5e77cd-45dc-4f36-9a1f-314cad75f5db",
      storagePath:
        "5e5e77cd-45dc-4f36-9a1f-314cad75f5db/26aa9e8f1f6c4eb2bb97e151f1c63e45.jpg",
    };

    await expect(confirmMediaUploadReservation(client, input)).resolves.toBe(
      "rejected",
    );
  });

  it("cancels an outstanding exact-path reservation without caller identity", async () => {
    const client = clientReturning({ data: true, error: null });
    const input = {
      listingId: "5e5e77cd-45dc-4f36-9a1f-314cad75f5db",
      storagePath:
        "5e5e77cd-45dc-4f36-9a1f-314cad75f5db/26aa9e8f1f6c4eb2bb97e151f1c63e45.jpg",
    };

    await expect(cancelMediaUploadReservation(client, input)).resolves.toBe(
      "cancelled",
    );
    expect(client.rpc).toHaveBeenCalledWith("cancel_listing_media_upload", {
      p_listing_id: input.listingId,
      p_storage_path: input.storagePath,
    });
  });

  it("marks a confirmed upload removed through the server-defined lifecycle", async () => {
    const client = clientReturning({ data: true, error: null });
    const input = {
      listingId: "5e5e77cd-45dc-4f36-9a1f-314cad75f5db",
      storagePath:
        "5e5e77cd-45dc-4f36-9a1f-314cad75f5db/26aa9e8f1f6c4eb2bb97e151f1c63e45.jpg",
    };

    await expect(markMediaUploadRemoved(client, input)).resolves.toBe(
      "removed",
    );
    expect(client.rpc).toHaveBeenCalledWith(
      "mark_listing_media_upload_removed",
      {
        p_listing_id: input.listingId,
        p_storage_path: input.storagePath,
      },
    );
  });
});
