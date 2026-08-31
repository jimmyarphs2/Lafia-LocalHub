import { z } from "zod";

export const LISTING_MEDIA_BUCKET = "listing-media";
export const MAX_LISTING_MEDIA_BYTES = 20 * 1024 * 1024;
export const MEDIA_MUTATION_HEADER = "x-localhub-media-mutation";
export const MEDIA_MUTATION_HEADER_VALUE = "listing-media-v1";

const MIME_EXTENSION_MAP = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "video/mp4": ["mp4"],
} as const;

export const LISTING_MEDIA_ACCEPT = Object.keys(MIME_EXTENSION_MAP).join(",");
export const LISTING_MEDIA_CAMERA_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
].join(",");

export type AllowedListingMediaMime = keyof typeof MIME_EXTENSION_MAP;
export type ListingMediaKind = "document" | "image" | "video";

const versionFourUuidSchema = z
  .string()
  .uuid()
  .refine(
    (value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
    "Upload request identifiers must be random version 4 UUIDs.",
  );

const fileNameSchema = z
  .string()
  .trim()
  .min(1, "Choose a file before uploading.")
  .max(255, "The file name is too long.")
  .refine((value) => !value.includes("\0"), "The file name is not valid.");

const mimeTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (value): value is AllowedListingMediaMime => value in MIME_EXTENSION_MAP,
    "Use a JPEG, PNG, WebP, MP4, or PDF file.",
  );

const baseMediaMutationSchema = z
  .object({
    listingId: z.string().uuid(),
    fileName: fileNameSchema,
    mimeType: mimeTypeSchema,
    sizeBytes: z
      .number()
      .int()
      .positive("The selected file is empty.")
      .max(
        MAX_LISTING_MEDIA_BYTES,
        "The selected file is larger than the 20 MB limit.",
      ),
    idempotencyKey: versionFourUuidSchema,
  })
  .strict();

function extensionMatchesMimeType(fileName: string, mimeType: string): boolean {
  const extension = getFileExtension(fileName);
  if (!extension || !(mimeType in MIME_EXTENSION_MAP)) return false;

  return (MIME_EXTENSION_MAP as Record<string, readonly string[]>)[
    mimeType
  ].includes(extension);
}

export const mediaNegotiationSchema = baseMediaMutationSchema.superRefine(
  (input, context) => {
    if (!extensionMatchesMimeType(input.fileName, input.mimeType)) {
      context.addIssue({
        code: "custom",
        path: ["fileName"],
        message: "The file extension does not match its declared type.",
      });
    }
  },
);

export const mediaConfirmationSchema = baseMediaMutationSchema
  .extend({
    storagePath: z
      .string()
      .min(1)
      .max(220)
      .regex(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[A-Za-z0-9_-]{22,128}\.[A-Za-z0-9]{2,8}$/,
        "The storage path is not valid.",
      ),
    altText: z.string().trim().max(500).optional().default(""),
  })
  .strict()
  .superRefine((input, context) => {
    if (!extensionMatchesMimeType(input.fileName, input.mimeType)) {
      context.addIssue({
        code: "custom",
        path: ["fileName"],
        message: "The file extension does not match its declared type.",
      });
    }

    if (
      getFileExtension(input.fileName) &&
      input.storagePath !== createCanonicalMediaPath(input)
    ) {
      context.addIssue({
        code: "custom",
        path: ["storagePath"],
        message: "The storage path does not match this upload request.",
      });
    }
  });

export const mediaRemovalSchema = baseMediaMutationSchema
  .extend({
    storagePath: z.string().min(1).max(220),
  })
  .strict()
  .superRefine((input, context) => {
    if (!extensionMatchesMimeType(input.fileName, input.mimeType)) {
      context.addIssue({
        code: "custom",
        path: ["fileName"],
        message: "The file extension does not match its declared type.",
      });
    }

    if (
      getFileExtension(input.fileName) &&
      input.storagePath !== createCanonicalMediaPath(input)
    ) {
      context.addIssue({
        code: "custom",
        path: ["storagePath"],
        message: "The storage path does not match this upload request.",
      });
    }
  });

export type MediaNegotiationInput = z.infer<typeof mediaNegotiationSchema>;
export type MediaConfirmationInput = z.infer<typeof mediaConfirmationSchema>;
export type MediaRemovalInput = z.infer<typeof mediaRemovalSchema>;

export const mediaNegotiationSuccessSchema = z.object({
  ok: z.literal(true),
  bucket: z.literal(LISTING_MEDIA_BUCKET),
  storagePath: z.string(),
  uploadToken: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export const mediaConfirmationSuccessSchema = z.object({
  ok: z.literal(true),
  storagePath: z.string(),
  confirmed: z.literal(true),
  enhanced: z.literal(false),
  published: z.literal(false),
  originalRetained: z.literal(true),
});

export const mediaRemovalSuccessSchema = z.object({
  ok: z.literal(true),
  removed: z.literal(true),
});

export const mediaMutationErrorSchema = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

export type MediaMutationError = z.infer<typeof mediaMutationErrorSchema>;
export type MediaNegotiationSuccess = z.infer<
  typeof mediaNegotiationSuccessSchema
>;
export type MediaConfirmationSuccess = z.infer<
  typeof mediaConfirmationSuccessSchema
>;
export type MediaRemovalSuccess = z.infer<typeof mediaRemovalSuccessSchema>;

export const LISTING_MEDIA_REGISTRATION_OPTIONS = Object.freeze({
  onConflict: "storage_path",
  ignoreDuplicates: true,
} as const);

export function getFileExtension(fileName: string): string | null {
  const lastSegment = fileName.split(/[\\/]/).at(-1) ?? "";
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) return null;
  return lastSegment.slice(dotIndex + 1).toLowerCase();
}

export function sanitizeOriginalFileName(fileName: string): string {
  const lastSegment =
    fileName.normalize("NFKC").split(/[\\/]/).at(-1) ?? "file";
  const safeName = lastSegment
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .trim()
    .slice(0, 120);

  return safeName || "file";
}

export function createCanonicalMediaPath(input: {
  listingId: string;
  idempotencyKey: string;
  fileName: string;
}): string {
  const extension = getFileExtension(input.fileName);
  if (!extension) throw new Error("A valid file extension is required.");

  const objectName = input.idempotencyKey.replaceAll("-", "").toLowerCase();
  return `${input.listingId.toLowerCase()}/${objectName}.${extension}`;
}

export function getListingMediaKind(
  mimeType: AllowedListingMediaMime,
): ListingMediaKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}
