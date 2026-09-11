import { NextResponse } from "next/server";

import {
  getConfiguredStalledSchedulerSecret,
  isAuthorizedStalledSchedulerRequest,
} from "@/lib/onboarding/stalled-scheduler-auth";
import { loadOnboardingDrafts } from "@/lib/onboarding/persistence";
import { processStalledOnboardingDrafts } from "@/lib/orbit/localhub-stalled-workflow";
import { getServerAdminSupabaseClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DRAFT_SCAN_LIMIT = 500;

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function authorize(request: Request): Response | null {
  const secret = getConfiguredStalledSchedulerSecret();
  if (!secret) {
    return response(
      {
        ok: false,
        reason: "scheduler_not_configured",
      },
      503,
    );
  }

  if (!isAuthorizedStalledSchedulerRequest(request, secret)) {
    return response({ ok: false, reason: "unauthorized" }, 401);
  }

  return null;
}

/**
 * Server-authorized, staging-safe scheduler entry point.
 *
 * This endpoint only scans onboarding drafts and records governed decisions in
 * an in-memory ORBIT runtime. It never approves or sends a customer action.
 */
async function runStalledOnboardingDryRun() {
  const client = getServerAdminSupabaseClient();
  if (!client) {
    return response(
      {
        ok: false,
        reason: "database_not_configured",
      },
      503,
    );
  }

  const loaded = await loadOnboardingDrafts(client, DRAFT_SCAN_LIMIT);
  if (!loaded.ok) {
    return response(
      {
        ok: false,
        reason: loaded.reason,
      },
      503,
    );
  }

  const simulation = await processStalledOnboardingDrafts(loaded.drafts);
  const auditKinds = simulation.governed.store.audit.reduce<
    Record<string, number>
  >((counts, entry) => {
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
    return counts;
  }, {});

  return response({
    ok: true,
    mode: "dry_run",
    scannedDrafts: loaded.drafts.length,
    candidates: simulation.candidates.map((candidate) => ({
      merchantId: candidate.merchantId,
      hoursStalled: candidate.hoursStalled,
      nextStep: candidate.nextStep,
      sourceEventId: candidate.sourceEventId,
      decisionStatus:
        simulation.results.find(
          (result) => result.event.source.eventId === candidate.sourceEventId,
        )?.decision?.status ?? null,
      runStatus:
        simulation.results.find(
          (result) => result.event.source.eventId === candidate.sourceEventId,
        )?.run.status ?? null,
    })),
    auditKinds,
    autonomousAction: "disabled",
  });
}

export async function GET(request: Request) {
  const denied = authorize(request);
  return denied ?? runStalledOnboardingDryRun();
}

export async function POST(request: Request) {
  const denied = authorize(request);
  return denied ?? runStalledOnboardingDryRun();
}
