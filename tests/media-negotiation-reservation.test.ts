import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MEDIA_MUTATION_HEADER,
  MEDIA_MUTATION_HEADER_VALUE,
} from "@/lib/media/contracts";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  cancel: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  getClient: vi.fn(),
  reserve: vi.fn(),
}));

vi.mock("@/lib/media/authorization", () => ({
  authorizeListingMedia: mocks.authorize,
}));
vi.mock("@/lib/media/upload-governance", () => ({
  cancelMediaUploadReservation: mocks.cancel,
  reserveMediaUpload: mocks.reserve,
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: mocks.getClient,
}));

import { POST } from "@/app/api/vendor/media/negotiate/route";

const client = {
  storage: {
    from: () => ({ createSignedUploadUrl: mocks.createSignedUploadUrl }),
  },
};

function negotiationRequest(overrides: Record<string, unknown> = {}) {
  return new Request("https://localhub.example/api/vendor/media/negotiate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://localhub.example",
      "sec-fetch-site": "same-origin",
      [MEDIA_MUTATION_HEADER]: MEDIA_MUTATION_HEADER_VALUE,
    },
    body: JSON.stringify({
      listingId: "5e5e77cd-45dc-4f36-9a1f-314cad75f5db",
      fileName: "market-stall.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 2_400_000,
      idempotencyKey: "26aa9e8f-1f6c-4eb2-bb97-e151f1c63e45",
      ...overrides,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockResolvedValue(client);
  mocks.authorize.mockResolvedValue({
    ok: true,
    listing: {
      listingId: "5e5e77cd-45dc-4f36-9a1f-314cad75f5db",
      businessId: "2dd03116-25d7-4f7f-9703-e9cda24d265b",
      userId: "364af025-4039-49e7-80c5-ef46e158bf79",
    },
  });
  mocks.cancel.mockResolvedValue("cancelled");
  mocks.reserve.mockResolvedValue({
    ok: true,
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  mocks.createSignedUploadUrl.mockResolvedValue({
    data: { token: "transient-test-token" },
    error: null,
  });
});

describe("signed upload atomic reservation boundary", () => {
  it("authorizes, atomically reserves/quota-checks, then mints the target", async () => {
    const requestStartedAt = Date.now();
    const response = await POST(negotiationRequest());
    const body = (await response.json()) as { expiresAt: string };

    expect(response.status).toBe(200);
    expect(mocks.authorize.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.reserve.mock.invocationCallOrder[0],
    );
    expect(mocks.authorize).toHaveBeenCalledWith(
      client,
      "5e5e77cd-45dc-4f36-9a1f-314cad75f5db",
      "draft_upload",
    );
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createSignedUploadUrl.mock.invocationCallOrder[0],
    );
    expect(body.expiresAt).not.toBe("2099-01-01T00:00:00.000Z");
    expect(Date.parse(body.expiresAt)).toBeGreaterThanOrEqual(
      requestStartedAt + 2 * 60 * 60 * 1_000,
    );
  });

  it("cannot reserve or sign when manager authorization fails", async () => {
    mocks.authorize.mockResolvedValue({
      ok: false,
      reason: "listing_access_denied",
    });

    const response = await POST(negotiationRequest());

    expect(response.status).toBe(403);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("cannot sign when atomic quota/reservation fails", async () => {
    mocks.reserve.mockResolvedValue({ ok: false });

    const response = await POST(negotiationRequest());
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(503);
    expect(body.code).toBe("MEDIA_UPLOAD_RESERVATION_UNAVAILABLE");
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("cancels the exact reservation if signed-target creation fails", async () => {
    mocks.createSignedUploadUrl.mockResolvedValue({
      data: null,
      error: new Error("storage unavailable"),
    });

    const response = await POST(negotiationRequest());

    expect(response.status).toBe(503);
    expect(mocks.cancel).toHaveBeenCalledWith(client, {
      listingId: "5e5e77cd-45dc-4f36-9a1f-314cad75f5db",
      storagePath:
        "5e5e77cd-45dc-4f36-9a1f-314cad75f5db/26aa9e8f1f6c4eb2bb97e151f1c63e45.jpg",
    });
  });

  it("rejects invalid metadata before authorization or reservation", async () => {
    const response = await POST(
      negotiationRequest({ fileName: "market-stall.exe" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });
});
