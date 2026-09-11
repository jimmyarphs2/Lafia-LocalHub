import { describe, expect, it } from "vitest";

import { detectStalledOnboardingDrafts } from "@/lib/onboarding/stalled-detector";
import { emptyOnboardingDraft } from "@/lib/onboarding/schema";
import { processStalledOnboardingDrafts } from "@/lib/orbit/localhub-stalled-workflow";
import { createLocalHubGovernedRuntime } from "@/lib/orbit/localhub-governed-runtime";

const now = new Date("2026-09-11T12:00:00.000Z");

function draft(
  overrides: Partial<{
    businessId: string;
    step:
      "business" | "category" | "profile" | "location" | "review" | "complete";
    updatedAt: string;
    email: string;
  }> = {},
) {
  const {
    businessId = "11111111-1111-4111-8111-111111111111",
    step = "profile",
    updatedAt = "2026-09-10T10:00:00.000Z",
    email = "merchant@example.com",
  } = overrides;

  return {
    businessId,
    step,
    updatedAt,
    values: {
      ...emptyOnboardingDraft,
      businessName: "Amina Foods",
      originalOffering: "Fresh meals",
      email,
    },
  };
}

describe("LocalHub stalled onboarding detector", () => {
  it("selects only stale resumable drafts and creates stable event keys", () => {
    const candidates = detectStalledOnboardingDrafts(
      [
        draft(),
        draft({
          businessId: "22222222-2222-4222-8222-222222222222",
          updatedAt: "2026-09-11T08:30:00.000Z",
        }),
        draft({
          businessId: "33333333-3333-4333-8333-333333333333",
          step: "complete",
          updatedAt: "2026-09-09T10:00:00.000Z",
        }),
      ],
      { now },
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      merchantId: "11111111-1111-4111-8111-111111111111",
      hoursStalled: 26,
      recipient: "merchant@example.com",
      nextStep: "Tell us where you operate",
      sourceEventId:
        "onboarding-stalled:11111111-1111-4111-8111-111111111111:2026-09-10T10:00:00.000Z",
    });
    expect(detectStalledOnboardingDrafts([draft()], { now })).toEqual(
      candidates,
    );
  });

  it("runs the detected candidate through the staging-safe governed runtime", async () => {
    const governed = createLocalHubGovernedRuntime();
    const simulation = await processStalledOnboardingDrafts([draft()], {
      now,
      governed,
    });

    expect(simulation.candidates).toHaveLength(1);
    expect(simulation.results[0]).toMatchObject({
      decision: {
        status: "founder_review_required",
        risk: "medium",
      },
      run: { status: "waiting_approval" },
      execution: null,
      memory: {
        value: {
          status: "stalled",
          merchantId: "11111111-1111-4111-8111-111111111111",
        },
      },
    });

    const pending = simulation.results[0];
    const approved = await governed.approveMerchantOnboardingFollowup({
      eventId: pending.event.id,
      approvedBy: "founder:jimmy",
    });

    expect(approved).toMatchObject({
      run: { status: "succeeded" },
      execution: {
        duplicate: false,
        result: { status: "drafted", delivery: "draft_only" },
      },
    });
    expect(
      governed.store.audit.some(
        (entry) => entry.kind === "localhub.followup.sent",
      ),
    ).toBe(false);
  });
});
