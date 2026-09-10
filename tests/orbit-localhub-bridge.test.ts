import { describe, expect, it } from "vitest";

import {
  createLocalHubOrbitBridge,
  MERCHANT_ONBOARDING_STALLED_EVENT,
  toMerchantOnboardingStalledEvent,
  type LocalHubOrbitEvent,
} from "@/lib/orbit/localhub-bridge";

describe("LocalHub–ORBIT bridge", () => {
  it("maps the first LocalHub control-loop event without performing an external action", async () => {
    const admitted: LocalHubOrbitEvent[] = [];
    const bridge = createLocalHubOrbitBridge({
      ingest(event) {
        admitted.push(event);
        return { accepted: true };
      },
    });

    await expect(
      bridge.emitMerchantOnboardingStalled({
        merchantId: "merchant-123",
        hoursStalled: 25,
        recipient: "merchant@example.com",
        nextStep: "Complete your first listing",
        sourceEventId: "onboarding-123",
        occurredAt: "2026-09-10T12:00:00Z",
      }),
    ).resolves.toEqual({ accepted: true });

    expect(admitted).toHaveLength(1);
    expect(admitted[0]).toEqual({
      companyId: "localhub",
      type: MERCHANT_ONBOARDING_STALLED_EVENT,
      occurredAt: "2026-09-10T12:00:00.000Z",
      source: { system: "localhub", eventId: "onboarding-123" },
      subject: { aggregateId: "merchant-123" },
      payload: {
        hoursStalled: 25,
        recipient: "merchant@example.com",
        nextStep: "Complete your first listing",
      },
      idempotencyKey: "onboarding-123",
      schemaVersion: "1.0.0",
    });
  });

  it("uses the source event as the idempotency key and keeps the envelope immutable", () => {
    const event = toMerchantOnboardingStalledEvent({
      merchantId: "merchant-123",
      hoursStalled: 0,
      nextStep: "Add a listing",
      sourceEventId: "onboarding-123",
      occurredAt: "2026-09-10T12:00:00Z",
    });

    expect(event.idempotencyKey).toBe("onboarding-123");
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(event.payload.recipient).toBeNull();
  });

  it.each([
    ["empty merchant id", { merchantId: " " }],
    ["negative stalled hours", { hoursStalled: -1 }],
    ["fractional stalled hours", { hoursStalled: 1.5 }],
    [
      "line break in recipient",
      { recipient: "merchant@example.com\nBcc: attacker@example.com" },
    ],
  ])("rejects unsafe input: %s", (_label, override) => {
    expect(() =>
      toMerchantOnboardingStalledEvent({
        merchantId: "merchant-123",
        hoursStalled: 25,
        nextStep: "Complete your first listing",
        sourceEventId: "onboarding-123",
        ...override,
      }),
    ).toThrow();
  });
});
