import { describe, expect, it } from "vitest";

import { createLocalHubGovernedRuntime } from "@/lib/orbit/localhub-governed-runtime";

const input = {
  merchantId: "merchant-123",
  hoursStalled: 25,
  recipient: "merchant@example.com",
  nextStep: "Complete your first listing",
  sourceEventId: "onboarding-123",
  occurredAt: "2026-09-10T12:00:00Z",
};

describe("LocalHub governed ORBIT runtime", () => {
  it("gates a stalled merchant behind founder approval", async () => {
    const governed = createLocalHubGovernedRuntime();

    const pending = await governed.processMerchantOnboardingStalled(input);

    expect(pending.decision).toMatchObject({
      status: "founder_review_required",
      risk: "medium",
      action: {
        type: "localhub.merchant.followup_draft.create",
        resource: "merchant:merchant-123",
      },
    });
    expect(pending.run.status).toBe("waiting_approval");
    expect(pending.execution).toBeNull();
    expect(pending.memory).toMatchObject({
      purpose: "localhub.merchant.onboarding",
      value: {
        status: "stalled",
        merchantId: "merchant-123",
      },
    });

    const auditKinds = governed.store.audit.map((entry) => entry.kind);
    expect(auditKinds).toEqual(
      expect.arrayContaining([
        "event.admitted",
        "decision.recorded",
        "memory.admitted",
        "localhub.onboarding.memory_recorded",
      ]),
    );
    expect(auditKinds).not.toContain("mutation.executed");
  });

  it("executes only the approved internal draft through the mutation guard", async () => {
    const governed = createLocalHubGovernedRuntime();
    const pending = await governed.processMerchantOnboardingStalled(input);

    const approved = await governed.approveMerchantOnboardingFollowup({
      eventId: pending.event.id,
      approvedBy: "founder:jimmy",
    });

    expect(approved.execution).toMatchObject({
      duplicate: false,
      result: {
        status: "drafted",
        delivery: "draft_only",
        merchantId: "merchant-123",
      },
    });
    expect(approved.run.status).toBe("succeeded");

    const auditKinds = governed.store.audit.map((entry) => entry.kind);
    expect(auditKinds).toEqual(
      expect.arrayContaining([
        "approval.granted",
        "mutation.executed",
        "localhub.followup.draft_created",
      ]),
    );
    expect(auditKinds).not.toContain("localhub.followup.sent");

    const repeated = await governed.approveMerchantOnboardingFollowup({
      eventId: pending.event.id,
      approvedBy: "founder:jimmy",
    });
    expect(repeated.execution.duplicate).toBe(true);
    expect(repeated.run.status).toBe("succeeded");
  });

  it("keeps duplicate source events idempotent", async () => {
    const governed = createLocalHubGovernedRuntime();

    const first = await governed.processMerchantOnboardingStalled(input);
    const duplicate = await governed.processMerchantOnboardingStalled(input);

    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.event.id).toBe(first.event.id);
    expect(duplicate.run.id).toBe(first.run.id);
    expect(duplicate.memory).toBeNull();
    expect(duplicate.decision).toBeNull();
  });
});
