import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  adaptiveListingSchemaContract,
  type AdaptiveListingSchema,
} from "@/lib/ale/contract";
import type { ListingDraftValues } from "@/lib/listings/contract";
import type { Database } from "@/lib/supabase/database.types";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });

/** Narrow, public-safe projection of the selected authenticated draft. */
export type ListingDraftNormalizedRow = {
  listingId: string;
  revision: number;
  slug: string;
  values: ListingDraftValues;
  updatedAt: string;
};

export type ListingDraftSummary = Pick<
  ListingDraftNormalizedRow,
  "listingId" | "revision" | "updatedAt"
>;

export type VendorListingDraftWorkspace = {
  businessId: string;
  categoryId: string;
  categorySlug: string;
  mapping: {
    listingTypeId: string;
    listingTypeCode: string;
    schemaId: string;
    schemaKey: string;
    schemaVersion: number;
  };
  schema: AdaptiveListingSchema;
  selectedDraft: ListingDraftNormalizedRow | null;
};

export type ListingDraftWorkspaceResult =
  | { ok: true; workspace: VendorListingDraftWorkspace }
  | {
      ok: false;
      reason:
        | "workspace_unavailable"
        | "listing_unavailable"
        | "taxonomy_unavailable";
    };

/**
 * Exact `get_listing_draft_context` row contract. The function accepts exactly
 * one of `p_business_id` (create context) or `p_listing_id` (edit context).
 */
const rawContextRowSchema = z
  .object({
    mode: z.enum(["create", "edit"]),
    listing_id: uuidSchema.nullable(),
    business_id: uuidSchema,
    draft_revision: z.number().int().positive().nullable(),
    slug: z.string().min(1).max(160).nullable(),
    category_id: uuidSchema,
    category_slug: z.string().min(1).max(160),
    listing_type_id: uuidSchema,
    listing_type_code: z.string().min(1).max(80),
    listing_schema_id: uuidSchema,
    schema_key: z.string().min(1).max(100),
    schema_version: z.number().int().positive(),
    schema_document: z.unknown(),
    values: z.record(z.string().min(1).max(63), z.unknown()).nullable(),
    updated_at: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((row, context) => {
    if (
      row.mode === "edit" &&
      (!row.listing_id ||
        row.draft_revision === null ||
        !row.slug ||
        !row.values ||
        !row.updated_at)
    ) {
      context.addIssue({
        code: "custom",
        message: "Incomplete edit context.",
      });
    }
    if (
      row.mode === "create" &&
      (row.listing_id || row.draft_revision !== null || row.values !== null)
    ) {
      context.addIssue({ code: "custom", message: "Invalid create context." });
    }
  });

type ListingDraftRpcClient = Pick<SupabaseClient<Database>, "rpc">;

function workspaceErrorReason(
  error: unknown,
): Exclude<ListingDraftWorkspaceResult, { ok: true }>["reason"] {
  if (!error || typeof error !== "object") return "workspace_unavailable";
  const candidate = error as { code?: unknown; message?: unknown };
  const text = [candidate.code, candidate.message]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
  if (/(taxonomy_unavailable|taxonomy_stale|draft_values_invalid)/.test(text)) {
    return "taxonomy_unavailable";
  }
  if (/(draft_unavailable|42501)/.test(text)) return "listing_unavailable";
  return "workspace_unavailable";
}

export function parseVendorListingDraftWorkspace(
  value: unknown,
): VendorListingDraftWorkspace | null {
  const raw = rawContextRowSchema.safeParse(value);
  if (!raw.success) return null;

  const schema = adaptiveListingSchemaContract.safeParse(
    raw.data.schema_document,
  );
  if (!schema.success) return null;
  if (
    schema.data.schemaKey !== raw.data.schema_key ||
    schema.data.schemaVersion !== raw.data.schema_version
  ) {
    return null;
  }

  return {
    businessId: raw.data.business_id,
    categoryId: raw.data.category_id,
    categorySlug: raw.data.category_slug,
    mapping: {
      listingTypeId: raw.data.listing_type_id,
      listingTypeCode: raw.data.listing_type_code,
      schemaId: raw.data.listing_schema_id,
      schemaKey: raw.data.schema_key,
      schemaVersion: raw.data.schema_version,
    },
    schema: schema.data,
    selectedDraft:
      raw.data.mode === "edit" &&
      raw.data.listing_id &&
      raw.data.draft_revision !== null &&
      raw.data.slug &&
      raw.data.values &&
      raw.data.updated_at
        ? {
            listingId: raw.data.listing_id,
            revision: raw.data.draft_revision,
            slug: raw.data.slug,
            values: raw.data.values,
            updatedAt: raw.data.updated_at,
          }
        : null,
  };
}

export async function loadVendorListingDraftWorkspace(
  client: ListingDraftRpcClient,
  input: { targetBusinessId: string; listingId?: string },
): Promise<ListingDraftWorkspaceResult> {
  try {
    const { data, error } = await client.rpc(
      "get_listing_draft_context",
      input.listingId
        ? { p_listing_id: input.listingId }
        : { p_business_id: input.targetBusinessId },
    );
    if (error) return { ok: false, reason: workspaceErrorReason(error) };

    const workspace = parseVendorListingDraftWorkspace(
      Array.isArray(data) ? data[0] : data,
    );
    if (!workspace) return { ok: false, reason: "taxonomy_unavailable" };
    if (workspace.businessId !== input.targetBusinessId) {
      return { ok: false, reason: "listing_unavailable" };
    }
    if (
      input.listingId &&
      (!workspace.selectedDraft ||
        workspace.selectedDraft.listingId !== input.listingId)
    ) {
      return { ok: false, reason: "listing_unavailable" };
    }
    return { ok: true, workspace };
  } catch {
    return { ok: false, reason: "workspace_unavailable" };
  }
}
