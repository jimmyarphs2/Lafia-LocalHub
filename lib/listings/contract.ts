import { z } from "zod";

import type { AleFormValues } from "@/lib/ale/contract";

export const listingIdentifierSchema = z.string().uuid();

/**
 * Deliberately small action payload. Ownership, market, category, status, and
 * normalized database columns are resolved only by the authenticated RPC.
 */
export const saveVendorListingDraftInputSchema = z
  .object({
    targetBusinessId: listingIdentifierSchema,
    listingId: listingIdentifierSchema.optional(),
    expectedSchemaId: listingIdentifierSchema,
    expectedSchemaVersion: z.number().int().positive(),
    expectedRevision: z.number().int().positive().optional(),
    createIdempotencyKey: listingIdentifierSchema.optional(),
    values: z.record(z.string().min(1).max(63), z.unknown()),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.listingId) {
      if (input.createIdempotencyKey) {
        context.addIssue({
          code: "custom",
          message: "Create idempotency is not accepted when editing a listing.",
          path: ["createIdempotencyKey"],
        });
      }
      if (input.expectedRevision === undefined) {
        context.addIssue({
          code: "custom",
          message: "The current draft revision is required when editing.",
          path: ["expectedRevision"],
        });
      }
      return;
    }

    if (input.expectedRevision !== undefined) {
      context.addIssue({
        code: "custom",
        message: "A draft revision is only accepted when editing a listing.",
        path: ["expectedRevision"],
      });
    }
    if (!input.createIdempotencyKey) {
      context.addIssue({
        code: "custom",
        message: "A create idempotency key is required for a new listing.",
        path: ["createIdempotencyKey"],
      });
    }
  });

export type SaveVendorListingDraftInput = z.infer<
  typeof saveVendorListingDraftInputSchema
>;

export type ListingDraftValues = AleFormValues;
