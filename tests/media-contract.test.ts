import { describe, expect, it } from "vitest";

import {
  createCanonicalMediaPath,
  LISTING_MEDIA_REGISTRATION_OPTIONS,
  MAX_LISTING_MEDIA_BYTES,
  mediaConfirmationSchema,
  mediaNegotiationSchema,
  mediaRemovalSchema,
  sanitizeOriginalFileName,
} from "@/lib/media/contracts";

const firstListing = "5e5e77cd-45dc-4f36-9a1f-314cad75f5db";
const secondListing = "8a2db4a4-cd38-43f0-8770-4f231bfae2a5";
const uploadId = "26aa9e8f-1f6c-4eb2-bb97-e151f1c63e45";

const validInput = {
  listingId: firstListing,
  fileName: "market-stall.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 2_400_000,
  idempotencyKey: uploadId,
} as const;

describe("listing media upload contract", () => {
  it("rejects a MIME and extension mismatch", () => {
    expect(
      mediaNegotiationSchema.safeParse({
        ...validInput,
        fileName: "market-stall.png",
      }).success,
    ).toBe(false);
  });

  it("rejects files larger than the storage bucket limit", () => {
    expect(
      mediaNegotiationSchema.safeParse({
        ...validInput,
        sizeBytes: MAX_LISTING_MEDIA_BYTES + 1,
      }).success,
    ).toBe(false);
  });

  it("sanitizes a traversal-shaped display name and never uses it as the object name", () => {
    const unsafeName = "..\\..\\seller\u0000photo.jpg";
    const path = createCanonicalMediaPath({
      ...validInput,
      fileName: unsafeName,
    });

    expect(sanitizeOriginalFileName(unsafeName)).toBe("seller_photo.jpg");
    expect(path).toBe(`${firstListing}/26aa9e8f1f6c4eb2bb97e151f1c63e45.jpg`);
    expect(path).not.toContain("..");
    expect(path).not.toContain("\\");
  });

  it("creates a canonical listing-scoped path with an unguessable token", () => {
    expect(createCanonicalMediaPath(validInput)).toMatch(
      new RegExp(`^${firstListing}/[0-9a-f]{32}\\.jpg$`),
    );
  });

  it("rejects client-supplied business authority", () => {
    expect(
      mediaNegotiationSchema.safeParse({
        ...validInput,
        businessId: "2dd03116-25d7-4f7f-9703-e9cda24d265b",
      }).success,
    ).toBe(false);
  });

  it("rejects a path scoped to a different listing", () => {
    const otherPath = createCanonicalMediaPath({
      ...validInput,
      listingId: secondListing,
    });

    expect(
      mediaConfirmationSchema.safeParse({
        ...validInput,
        storagePath: otherPath,
        altText: "A vendor's market stall",
      }).success,
    ).toBe(false);
    expect(
      mediaRemovalSchema.safeParse({
        ...validInput,
        storagePath: otherPath,
      }).success,
    ).toBe(false);
  });

  it("keeps retry paths and metadata registration idempotent", () => {
    const firstPath = createCanonicalMediaPath(validInput);
    const retryPath = createCanonicalMediaPath({ ...validInput });

    expect(retryPath).toBe(firstPath);
    expect(LISTING_MEDIA_REGISTRATION_OPTIONS).toEqual({
      onConflict: "storage_path",
      ignoreDuplicates: true,
    });
  });
});
