import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { LISTING_MEDIA_BUCKET } from "@/lib/media/contracts";

export const DEFAULT_MEDIA_CLEANUP_BATCH_SIZE = 25;
export const MAX_MEDIA_CLEANUP_BATCH_SIZE = 100;

export const mediaCleanupRequestSchema = z
  .object({
    batchSize: z
      .number()
      .int()
      .min(1)
      .max(MAX_MEDIA_CLEANUP_BATCH_SIZE)
      .optional()
      .default(DEFAULT_MEDIA_CLEANUP_BATCH_SIZE),
  })
  .strict();

const canonicalStoragePathSchema = z
  .string()
  .max(220)
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{32}\.(?:jpeg|jpg|mp4|pdf|png|webp)$/,
  );

const cleanupCandidateSchema = z
  .object({
    storage_path: canonicalStoragePathSchema,
    cleanup_claim_token: z.string().uuid(),
  })
  .strict();

const failureTargetSchema = z
  .object({
    storage_path: z.string().min(1).max(220),
    cleanup_claim_token: z.string().uuid(),
  })
  .strict();

const cleanupClaimResponseSchema = z
  .array(z.unknown())
  .max(MAX_MEDIA_CLEANUP_BATCH_SIZE);

type CleanupCandidate = z.infer<typeof cleanupCandidateSchema>;

export type OrphanMediaCleanupCounts = {
  claimed: number;
  completed: number;
  failed: number;
};

export type OrphanMediaCleanupResult =
  | { ok: true; counts: OrphanMediaCleanupCounts }
  | {
      ok: false;
      fatal: boolean;
      counts: OrphanMediaCleanupCounts;
    };

const EMPTY_COUNTS: OrphanMediaCleanupCounts = Object.freeze({
  claimed: 0,
  completed: 0,
  failed: 0,
});

async function markCleanupFailure(
  client: SupabaseClient,
  candidate: unknown,
  errorCode:
    "CLEANUP_COMPLETE_FAILED" | "INVALID_CANDIDATE" | "STORAGE_REMOVE_FAILED",
): Promise<void> {
  const failureTarget = failureTargetSchema.safeParse(candidate);
  if (!failureTarget.success) return;

  try {
    await client.rpc("fail_orphan_listing_media_cleanup", {
      p_storage_path: failureTarget.data.storage_path,
      p_cleanup_claim_token: failureTarget.data.cleanup_claim_token,
      p_error: errorCode,
    });
  } catch {
    // The stale database claim becomes retryable. Do not log candidate data.
  }
}

async function completeCleanup(
  client: SupabaseClient,
  candidate: CleanupCandidate,
): Promise<boolean> {
  try {
    const { data, error } = await client.rpc(
      "complete_orphan_listing_media_cleanup",
      {
        p_storage_path: candidate.storage_path,
        p_cleanup_claim_token: candidate.cleanup_claim_token,
      },
    );
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * Processes only exact, canonical paths returned by the service-role claim RPC.
 * Each failed claim is released through a bounded generic failure code when its
 * identifiers are safe enough to address; otherwise the database stale-claim
 * timeout provides the retry boundary.
 */
export async function runOrphanMediaCleanup(
  client: SupabaseClient,
  batchSize: number,
): Promise<OrphanMediaCleanupResult> {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_MEDIA_CLEANUP_BATCH_SIZE
  ) {
    return { ok: false, fatal: true, counts: EMPTY_COUNTS };
  }

  let claimResponse: { data: unknown; error: unknown };
  try {
    claimResponse = await client.rpc("claim_orphan_listing_media_cleanup", {
      p_batch_size: batchSize,
    });
  } catch {
    return { ok: false, fatal: true, counts: EMPTY_COUNTS };
  }

  if (claimResponse.error) {
    return { ok: false, fatal: true, counts: EMPTY_COUNTS };
  }

  const claimedRows = cleanupClaimResponseSchema.safeParse(claimResponse.data);
  if (!claimedRows.success || claimedRows.data.length > batchSize) {
    return { ok: false, fatal: true, counts: EMPTY_COUNTS };
  }

  const counts: OrphanMediaCleanupCounts = {
    claimed: claimedRows.data.length,
    completed: 0,
    failed: 0,
  };

  for (const row of claimedRows.data) {
    const candidate = cleanupCandidateSchema.safeParse(row);
    if (!candidate.success) {
      counts.failed += 1;
      await markCleanupFailure(client, row, "INVALID_CANDIDATE");
      continue;
    }

    let storageRemoved = false;
    try {
      const result = await client.storage
        .from(LISTING_MEDIA_BUCKET)
        .remove([candidate.data.storage_path]);
      storageRemoved = !result.error;
    } catch {
      storageRemoved = false;
    }

    if (!storageRemoved) {
      counts.failed += 1;
      await markCleanupFailure(client, candidate.data, "STORAGE_REMOVE_FAILED");
      continue;
    }

    if (await completeCleanup(client, candidate.data)) {
      counts.completed += 1;
      continue;
    }

    counts.failed += 1;
    await markCleanupFailure(client, candidate.data, "CLEANUP_COMPLETE_FAILED");
  }

  if (counts.failed > 0) {
    return { ok: false, fatal: false, counts };
  }
  return { ok: true, counts };
}
