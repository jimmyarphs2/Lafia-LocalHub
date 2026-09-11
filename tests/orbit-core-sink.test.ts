import { describe, expect, it } from "vitest";

import { createLocalHubOrbitBridge } from "@/lib/orbit/localhub-bridge";
import { createOrbitCoreEventSink } from "@/lib/orbit/orbit-core-sink";

describe("LocalHub ORBIT core sink", () => {
  it("admits bridge events through the released ORBIT event engine", async () => {
    const sink = createOrbitCoreEventSink();
    const bridge = createLocalHubOrbitBridge(sink);

    const input = {
      merchantId: "merchant-123",
      hoursStalled: 25,
      recipient: "merchant@example.com",
      nextStep: "Complete your first listing",
      sourceEventId: "onboarding-123",
      occurredAt: "2026-09-10T12:00:00Z",
    };

    const first = await bridge.emitMerchantOnboardingStalled(input);
    const duplicate = await bridge.emitMerchantOnboardingStalled(input);

    expect(first).toMatchObject({
      duplicate: false,
      event: {
        companyId: "localhub",
        type: "localhub.merchant.onboarding_stalled",
        idempotencyKey: "onboarding-123",
      },
    });
    expect(duplicate).toMatchObject({
      duplicate: true,
      event: {
        companyId: "localhub",
        type: "localhub.merchant.onboarding_stalled",
        idempotencyKey: "onboarding-123",
      },
    });
    expect(duplicate.event.id).toBe(first.event.id);
  });
});
