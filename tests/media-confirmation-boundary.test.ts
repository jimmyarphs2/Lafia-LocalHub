import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MEDIA_MUTATION_HEADER,
  MEDIA_MUTATION_HEADER_VALUE,
} from "@/lib/media/contracts";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  confirmReservation: vi.fn(),
  getClient: vi.fn(),
  info: vi.fn(),
  register: vi.fn(),
}));

vi.mock("@/lib/media/authorization", () => ({
  authorizeListingMedia: mocks.authorize,
}));
vi.mock("@/lib/media/upload-governance", () => ({
  confirmMediaUploadReservation: mocks.confirmReservation,
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: mocks.getClient,
}));

import { POST } from "@/app/api/vendor/media/confirm/route";

const listingId = "5e5e77cd-45dc-4f36-9a1f-314cad75f5db";
const storagePath =
  "5e5e77cd-45dc-4f36-9a1f-314cad75f5db/26aa9e8f1f6c4eb2bb97e151f1c63e45.jpg";
const client = {
  from: () => ({ upsert: mocks.register }),
  storage: { from: () => ({ info: mocks.info }) },
};

function confirmationRequest() {
  return new Request("https://localhub.example/api/vendor/media/confirm", {
    method: "POST",
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
      altText: "A market stall",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockResolvedValue(client);
  mocks.authorize.mockResolvedValue({
    ok: true,
    listing: {
      listingId,
      businessId: "2dd03116-25d7-4f7f-9703-e9cda24d265b",
      userId: "364af025-4039-49e7-80c5-ef46e158bf79",
    },
  });
  mocks.info.mockResolvedValue({
    data: { contentType: "image/jpeg", name: storagePath, size: 2_400_000 },
    error: null,
  });
  mocks.confirmReservation.mockResolvedValue("confirmed");
  mocks.register.mockResolvedValue({ data: null, error: null });
});

describe("media confirmation mutation boundary", () => {
  it("checks auth and stored bytes before reservation confirmation and registration", async () => {
    const response = await POST(confirmationRequest());

    expect(response.status).toBe(200);
    expect(mocks.authorize.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.info.mock.invocationCallOrder[0],
    );
    expect(mocks.authorize).toHaveBeenCalledWith(
      client,
      listingId,
      "draft_upload",
    );
    expect(mocks.info.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.confirmReservation.mock.invocationCallOrder[0],
    );
    expect(mocks.confirmReservation.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.register.mock.invocationCallOrder[0],
    );
  });

  it("never confirms or registers mismatched stored bytes", async () => {
    mocks.info.mockResolvedValue({
      data: { contentType: "image/png", name: storagePath, size: 2_400_000 },
      error: null,
    });

    const response = await POST(confirmationRequest());

    expect(response.status).toBe(422);
    expect(mocks.confirmReservation).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("never registers metadata without an affirmative reservation transition", async () => {
    mocks.confirmReservation.mockResolvedValue("rejected");

    const response = await POST(confirmationRequest());

    expect(response.status).toBe(409);
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
