import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MEDIA_MUTATION_HEADER,
  MEDIA_MUTATION_HEADER_VALUE,
} from "@/lib/media/contracts";

const mocks = vi.hoisted(() => ({
  adminRemove: vi.fn(),
  authorize: vi.fn(),
  cancel: vi.fn(),
  getAdminClient: vi.fn(),
  getUserClient: vi.fn(),
  markRemoved: vi.fn(),
  adminMetadataDelete: vi.fn(),
  adminMetadataFirstEq: vi.fn(),
  adminMetadataSecondEq: vi.fn(),
  adminFrom: vi.fn(),
  userFrom: vi.fn(),
}));

vi.mock("@/lib/media/authorization", () => ({
  authorizeListingMedia: mocks.authorize,
}));
vi.mock("@/lib/media/upload-governance", () => ({
  cancelMediaUploadReservation: mocks.cancel,
  markMediaUploadRemoved: mocks.markRemoved,
}));
vi.mock("@/lib/supabase/admin", () => ({
  getServerAdminSupabaseClient: mocks.getAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: mocks.getUserClient,
}));

import { DELETE } from "@/app/api/vendor/media/remove/route";

const listingId = "5e5e77cd-45dc-4f36-9a1f-314cad75f5db";
const storagePath =
  "5e5e77cd-45dc-4f36-9a1f-314cad75f5db/26aa9e8f1f6c4eb2bb97e151f1c63e45.jpg";

const userClient = {
  from: mocks.userFrom,
};
const adminClient = {
  storage: { from: () => ({ remove: mocks.adminRemove }) },
  from: mocks.adminFrom,
};

function removalRequest(overrides: Record<string, unknown> = {}) {
  return new Request("https://localhub.example/api/vendor/media/remove", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      origin: "https://localhub.example",
      "sec-fetch-site": "same-origin",
      [MEDIA_MUTATION_HEADER]: MEDIA_MUTATION_HEADER_VALUE,
    },
    body: JSON.stringify({
      listingId,
      fileName: "market-stall.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 2_400_000,
      idempotencyKey: "26aa9e8f-1f6c-4eb2-bb97-e151f1c63e45",
      storagePath,
      ...overrides,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserClient.mockResolvedValue(userClient);
  mocks.authorize.mockResolvedValue({
    ok: true,
    listing: {
      listingId,
      businessId: "2dd03116-25d7-4f7f-9703-e9cda24d265b",
      userId: "364af025-4039-49e7-80c5-ef46e158bf79",
    },
  });
  mocks.getAdminClient.mockReturnValue(adminClient);
  mocks.adminRemove.mockResolvedValue({ data: [], error: null });
  mocks.adminFrom.mockReturnValue({ delete: mocks.adminMetadataDelete });
  mocks.adminMetadataDelete.mockReturnValue({
    eq: mocks.adminMetadataFirstEq,
  });
  mocks.adminMetadataFirstEq.mockReturnValue({
    eq: mocks.adminMetadataSecondEq,
  });
  mocks.adminMetadataSecondEq.mockResolvedValue({ data: null, error: null });
  mocks.markRemoved.mockResolvedValue("removed");
  mocks.cancel.mockResolvedValue("cancelled");
});

describe("media removal mutation boundary", () => {
  it("validates the canonical path before user authorization or admin mutation", async () => {
    const response = await DELETE(
      removalRequest({
        storagePath:
          "8a2db4a4-cd38-43f0-8770-4f231bfae2a5/26aa9e8f1f6c4eb2bb97e151f1c63e45.jpg",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.getAdminClient).not.toHaveBeenCalled();
    expect(mocks.adminRemove).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("never obtains or uses the admin client when manager authorization fails", async () => {
    mocks.authorize.mockResolvedValue({
      ok: false,
      reason: "listing_access_denied",
    });

    const response = await DELETE(removalRequest());

    expect(response.status).toBe(403);
    expect(mocks.getAdminClient).not.toHaveBeenCalled();
    expect(mocks.adminRemove).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("uses admin mutations only after user auth, then audits removal", async () => {
    const response = await DELETE(removalRequest());

    expect(response.status).toBe(200);
    expect(mocks.authorize.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getAdminClient.mock.invocationCallOrder[0],
    );
    expect(mocks.authorize).toHaveBeenCalledWith(
      userClient,
      listingId,
      "cleanup",
    );
    expect(mocks.getAdminClient.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.adminRemove.mock.invocationCallOrder[0],
    );
    expect(mocks.adminRemove.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.adminMetadataDelete.mock.invocationCallOrder[0],
    );
    expect(
      mocks.adminMetadataSecondEq.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.markRemoved.mock.invocationCallOrder[0]);
    expect(mocks.adminRemove).toHaveBeenCalledWith([storagePath]);
    expect(mocks.adminFrom).toHaveBeenCalledWith("listing_media");
    expect(mocks.adminMetadataFirstEq).toHaveBeenCalledWith(
      "listing_id",
      listingId,
    );
    expect(mocks.adminMetadataSecondEq).toHaveBeenCalledWith(
      "storage_path",
      storagePath,
    );
    expect(mocks.userFrom).not.toHaveBeenCalled();
    expect(mocks.markRemoved).toHaveBeenCalledWith(userClient, {
      listingId,
      storagePath,
    });
  });

  it("fails closed before mutation when the server-only admin client is absent", async () => {
    mocks.getAdminClient.mockReturnValue(null);

    const response = await DELETE(removalRequest());

    expect(response.status).toBe(503);
    expect(mocks.adminRemove).not.toHaveBeenCalled();
    expect(mocks.adminMetadataDelete).not.toHaveBeenCalled();
    expect(mocks.markRemoved).not.toHaveBeenCalled();
  });

  it("surfaces an exact admin metadata deletion failure before audit", async () => {
    mocks.adminMetadataSecondEq.mockResolvedValue({
      data: null,
      error: new Error("db"),
    });

    const response = await DELETE(removalRequest());

    expect(response.status).toBe(503);
    expect(mocks.adminRemove).toHaveBeenCalledWith([storagePath]);
    expect(mocks.adminMetadataSecondEq).toHaveBeenCalledWith(
      "storage_path",
      storagePath,
    );
    expect(mocks.markRemoved).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("surfaces a failed confirmed-media audit transition after deletion", async () => {
    mocks.markRemoved.mockResolvedValue("unavailable");

    const response = await DELETE(removalRequest());
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(503);
    expect(body.code).toBe("MEDIA_REMOVE_FAILED");
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("cancels an outstanding reservation when no confirmed lifecycle exists", async () => {
    mocks.markRemoved.mockResolvedValue("not_confirmed");

    const response = await DELETE(removalRequest());

    expect(response.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith(userClient, {
      listingId,
      storagePath,
    });
  });
});
