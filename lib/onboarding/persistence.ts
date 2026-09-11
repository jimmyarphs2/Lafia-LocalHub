import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  parsePersistedDraftValues,
  parsePersistedStep,
  type OnboardingDraftValues,
  type PersistedOnboardingStep,
} from "@/lib/onboarding/schema";
import { createOnboardingBusinessSlug } from "@/lib/onboarding/slug";

const uuidSchema = z.string().uuid();

export type OnboardingDraftRecord = {
  businessId: string;
  step: PersistedOnboardingStep;
  updatedAt: string;
  values: OnboardingDraftValues;
};

export type LoadOnboardingDraftResult =
  | { ok: true; draft: OnboardingDraftRecord | null }
  | { ok: false; reason: "database_unavailable" };

export type SaveOnboardingDraftResult =
  | { ok: true; businessId: string }
  | {
      ok: false;
      reason:
        | "database_unavailable"
        | "launch_market_unavailable"
        | "onboarding_rpc_unavailable";
    };

type RawDraftRow = {
  business_id: unknown;
  data: unknown;
  step: unknown;
  updated_at: unknown;
};

function parseDraftRow(value: unknown): OnboardingDraftRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as RawDraftRow;
  const businessId = uuidSchema.safeParse(row.business_id);
  if (!businessId.success || typeof row.updated_at !== "string") return null;

  return {
    businessId: businessId.data,
    step: parsePersistedStep(row.step),
    updatedAt: row.updated_at,
    values: parsePersistedDraftValues(row.data),
  };
}

export async function loadOnboardingDraft(
  client: SupabaseClient,
  ownerId: string,
): Promise<LoadOnboardingDraftResult> {
  const { data, error } = await client
    .from("business_onboarding_drafts")
    .select("business_id, step, data, updated_at")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { ok: false, reason: "database_unavailable" };
  if (!data) return { ok: true, draft: null };

  const draft = parseDraftRow(data);
  return draft
    ? { ok: true, draft }
    : { ok: false, reason: "database_unavailable" };
}

export type LoadOnboardingDraftsResult =
  | { ok: true; drafts: OnboardingDraftRecord[] }
  | { ok: false; reason: "database_unavailable" };

export async function loadOnboardingDrafts(
  client: SupabaseClient,
  limit = 500,
): Promise<LoadOnboardingDraftsResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new RangeError("limit must be an integer between 1 and 5000");
  }

  const { data, error } = await client
    .from("business_onboarding_drafts")
    .select("business_id, step, data, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !Array.isArray(data)) {
    return { ok: false, reason: "database_unavailable" };
  }

  return {
    ok: true,
    drafts: data.flatMap((row) => {
      const draft = parseDraftRow(row);
      return draft ? [draft] : [];
    }),
  };
}

async function findLaunchMarketId(
  client: SupabaseClient,
  marketSlug: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("markets")
    .select("id")
    .eq("slug", marketSlug)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data || typeof data !== "object") return null;
  const parsed = uuidSchema.safeParse((data as { id?: unknown }).id);
  return parsed.success ? parsed.data : null;
}

async function startOnboarding(
  client: SupabaseClient,
  ownerId: string,
  values: OnboardingDraftValues,
): Promise<SaveOnboardingDraftResult> {
  const marketId = await findLaunchMarketId(client, values.marketSlug);
  if (!marketId) return { ok: false, reason: "launch_market_unavailable" };

  const businessSlug = createOnboardingBusinessSlug(
    values.businessName,
    ownerId,
  );
  const { data, error } = await client.rpc("start_business_onboarding", {
    target_market: marketId,
    business_name: values.businessName,
    business_slug: businessSlug,
  });

  const businessId = uuidSchema.safeParse(data);
  if (!error && businessId.success) {
    return { ok: true, businessId: businessId.data };
  }

  // A lost response or duplicate submission may have created the draft already.
  // Re-read through RLS before reporting a failure, making the adapter retry-safe.
  const existing = await loadOnboardingDraft(client, ownerId);
  if (existing.ok && existing.draft) {
    return { ok: true, businessId: existing.draft.businessId };
  }

  return { ok: false, reason: "onboarding_rpc_unavailable" };
}

export async function saveOnboardingDraft(
  client: SupabaseClient,
  ownerId: string,
  step: PersistedOnboardingStep,
  values: OnboardingDraftValues,
): Promise<SaveOnboardingDraftResult> {
  const existing = await loadOnboardingDraft(client, ownerId);
  if (!existing.ok) return existing;

  const business = existing.draft
    ? { ok: true as const, businessId: existing.draft.businessId }
    : await startOnboarding(client, ownerId, values);
  if (!business.ok) return business;

  const { error } = await client.rpc("save_business_onboarding_draft", {
    target_business: business.businessId,
    next_step: step,
    draft_data: {
      onboardingVersion: 1,
      values,
    },
  });

  if (error) return { ok: false, reason: "onboarding_rpc_unavailable" };
  return { ok: true, businessId: business.businessId };
}
