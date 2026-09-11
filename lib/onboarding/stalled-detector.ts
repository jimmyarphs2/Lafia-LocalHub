import type { MerchantOnboardingStalledInput } from "@/lib/orbit/localhub-bridge";
import type { OnboardingDraftRecord } from "@/lib/onboarding/persistence";

const DEFAULT_STALLED_HOURS = 24;
const MAX_STALLED_HOURS = 8760;
const HOUR_MS = 60 * 60 * 1000;

const NEXT_STEP_BY_STEP: Record<OnboardingDraftRecord["step"], string> = {
  business: "Choose a category",
  category: "Add your business profile",
  profile: "Tell us where you operate",
  location: "Review your details",
  review: "Finish onboarding",
  complete: "Onboarding is complete",
};

export type StalledOnboardingDetectorOptions = {
  now?: Date;
  thresholdHours?: number;
};

function validDate(value: Date | string): Date | null {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Finds resumable onboarding drafts that have not changed past the follow-up
 * threshold. This function is pure: it reads no database and performs no
 * external action.
 */
export function detectStalledOnboardingDrafts(
  drafts: readonly OnboardingDraftRecord[],
  options: StalledOnboardingDetectorOptions = {},
): MerchantOnboardingStalledInput[] {
  const now = validDate(options.now ?? new Date());
  if (!now) throw new TypeError("now must be a valid timestamp");

  const thresholdHours = options.thresholdHours ?? DEFAULT_STALLED_HOURS;
  if (
    !Number.isInteger(thresholdHours) ||
    thresholdHours <= 0 ||
    thresholdHours > MAX_STALLED_HOURS
  ) {
    throw new RangeError(
      `thresholdHours must be an integer between 1 and ${MAX_STALLED_HOURS}`,
    );
  }

  const nowMs = now.getTime();
  const seen = new Set<string>();

  return drafts.flatMap((draft) => {
    if (draft.step === "complete") return [];

    const updatedAt = validDate(draft.updatedAt);
    if (!updatedAt || updatedAt.getTime() >= nowMs) return [];

    const hoursStalled = Math.floor((nowMs - updatedAt.getTime()) / HOUR_MS);
    if (hoursStalled < thresholdHours) return [];

    const occurredAt = updatedAt.toISOString();
    const sourceEventId = `onboarding-stalled:${draft.businessId}:${occurredAt}`;
    if (seen.has(sourceEventId)) return [];
    seen.add(sourceEventId);

    const email =
      typeof draft.values.email === "string" ? draft.values.email.trim() : "";

    return [
      {
        merchantId: draft.businessId,
        hoursStalled: Math.min(hoursStalled, MAX_STALLED_HOURS),
        recipient: email || null,
        nextStep: NEXT_STEP_BY_STEP[draft.step],
        sourceEventId,
        occurredAt,
      },
    ];
  });
}
