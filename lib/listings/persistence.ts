import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { SaveVendorListingDraftInput } from "@/lib/listings/contract";
import type { Database } from "@/lib/supabase/database.types";

const uuidSchema = z.string().uuid();
const savedDraftSchema = z
  .object({
    listing_id: uuidSchema,
    business_id: uuidSchema,
    draft_revision: z.number().int().positive(),
    listing_schema_id: uuidSchema,
    schema_key: z.string().min(1).max(100),
    schema_version: z.number().int().positive(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();

export type SaveListingDraftPersistenceResult =
  | {
      ok: true;
      outcome: "created" | "updated";
      listingId: string;
      revision: number;
      savedAt: string;
    }
  | {
      ok: false;
      reason:
        | "conflict"
        | "draft_limit"
        | "rate_limited"
        | "taxonomy_unavailable"
        | "unavailable";
    };

type ListingDraftRpcClient = Pick<SupabaseClient<Database>, "rpc">;

function errorKind(
  error: unknown,
):
  | "conflict"
  | "draft_limit"
  | "rate_limited"
  | "taxonomy_unavailable"
  | "unavailable" {
  if (!error || typeof error !== "object") return "unavailable";
  const candidate = error as { code?: unknown; message?: unknown };
  const text = [candidate.code, candidate.message]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
  if (/(taxonomy_unavailable|taxonomy_stale)/.test(text)) {
    return "taxonomy_unavailable";
  }
  if (
    /(schema_stale|draft_revision_conflict|idempotency_key_reused)/.test(text)
  ) {
    return "conflict";
  }
  if (/draft_(create|save)_rate_limit_exceeded/.test(text)) {
    return "rate_limited";
  }
  if (/draft_open_limit_exceeded/.test(text)) return "draft_limit";
  return "unavailable";
}

/** Calls the manager-authorized draft RPC with no client-owned provenance. */
export async function saveListingDraft(
  client: ListingDraftRpcClient,
  input: SaveVendorListingDraftInput,
  slug: string,
): Promise<SaveListingDraftPersistenceResult> {
  try {
    const serializedPayload = JSON.stringify({ slug, values: input.values });
    const untrustedPayload: unknown = JSON.parse(serializedPayload);
    const payload = z.json().safeParse(untrustedPayload);
    if (!payload.success) return { ok: false, reason: "unavailable" };

    const { data, error } = await client.rpc("save_listing_draft", {
      p_expected_schema_id: input.expectedSchemaId,
      p_expected_schema_version: input.expectedSchemaVersion,
      p_payload: payload.data,
      ...(input.listingId
        ? {
            p_listing_id: input.listingId,
            p_expected_revision: input.expectedRevision,
          }
        : {
            p_business_id: input.targetBusinessId,
            p_idempotency_key: input.createIdempotencyKey,
          }),
    });
    if (error) return { ok: false, reason: errorKind(error) };

    const row = savedDraftSchema.safeParse(
      Array.isArray(data) ? data[0] : data,
    );
    if (!row.success || row.data.business_id !== input.targetBusinessId) {
      return { ok: false, reason: "unavailable" };
    }
    if (
      row.data.listing_schema_id !== input.expectedSchemaId ||
      row.data.schema_version !== input.expectedSchemaVersion
    ) {
      return { ok: false, reason: "conflict" };
    }

    return {
      // A compatible create retry returns the canonical row. The client does
      // not claim a separate replay outcome because the RPC exposes no marker.
      ok: true,
      outcome: input.listingId ? "updated" : "created",
      listingId: row.data.listing_id,
      revision: row.data.draft_revision,
      savedAt: row.data.updated_at,
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
