import { NextResponse } from "next/server";

import {
  getConfiguredMediaCleanupSecret,
  isAuthorizedMediaCleanupRequest,
} from "@/lib/media/cleanup-auth";
import {
  mediaCleanupRequestSchema,
  runOrphanMediaCleanup,
  type OrphanMediaCleanupCounts,
} from "@/lib/media/orphan-cleanup";
import { readBoundedBody } from "@/lib/http/bounded-body";
import { getServerAdminSupabaseClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_CLEANUP_REQUEST_BYTES = 1024;
const EMPTY_COUNTS: OrphanMediaCleanupCounts = Object.freeze({
  claimed: 0,
  completed: 0,
  failed: 0,
});

function cleanupResponse(
  ok: boolean,
  counts: OrphanMediaCleanupCounts,
  status: number,
) {
  return NextResponse.json(
    { ok, ...counts },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function readCleanupRequestBody(request: Request): Promise<unknown> {
  try {
    const bytes = await readBoundedBody(request, MAX_CLEANUP_REQUEST_BYTES);
    if (!bytes) return null;
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!body.trim()) return {};
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return null;
    }
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const secret = getConfiguredMediaCleanupSecret();
  if (!secret) return cleanupResponse(false, EMPTY_COUNTS, 503);

  if (!isAuthorizedMediaCleanupRequest(request, secret)) {
    return cleanupResponse(false, EMPTY_COUNTS, 401);
  }

  const input = mediaCleanupRequestSchema.safeParse(
    await readCleanupRequestBody(request),
  );
  if (!input.success) return cleanupResponse(false, EMPTY_COUNTS, 400);

  // Privileged client construction happens only after dedicated credential and
  // bounded input validation. This endpoint never delegates user authority.
  const client = getServerAdminSupabaseClient();
  if (!client) return cleanupResponse(false, EMPTY_COUNTS, 503);

  const result = await runOrphanMediaCleanup(client, input.data.batchSize);
  if (result.ok) return cleanupResponse(true, result.counts, 200);
  return cleanupResponse(false, result.counts, result.fatal ? 503 : 207);
}
