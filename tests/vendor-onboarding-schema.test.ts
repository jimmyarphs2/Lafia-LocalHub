import { describe, expect, it } from "vitest";

import {
  onboardingCompletionSchema,
  onboardingDraftValuesSchema,
  parsePersistedDraftValues,
} from "@/lib/onboarding/schema";
import { createOnboardingBusinessSlug } from "@/lib/onboarding/slug";

const completeDraft = {
  businessName: "Amina's Cakes",
  originalOffering: "I bake celebration cakes and small chops",
  categorySlug: "food-catering",
  categoryConfidence: "high" as const,
  description:
    "Made-to-order cakes and small chops for birthdays and local events.",
  phone: "+234 800 000 0000",
  whatsapp: "",
  email: "",
  marketSlug: "lafia",
  area: "Shendam Road",
  address: "",
};

describe("vendor onboarding validation", () => {
  it("accepts a complete launch-market draft", () => {
    expect(onboardingCompletionSchema.safeParse(completeDraft).success).toBe(
      true,
    );
  });

  it("requires one safe customer contact method before completion", () => {
    const result = onboardingCompletionSchema.safeParse({
      ...completeDraft,
      phone: "",
      whatsapp: "",
      email: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ["phone"] })]),
      );
    }
  });

  it("rejects unknown keys in the persisted UI-owned JSON envelope", () => {
    expect(
      onboardingDraftValuesSchema.safeParse({
        ...completeDraft,
        ownerId: "client-controlled-owner",
      }).success,
    ).toBe(false);
  });

  it("loads the versioned draft envelope without changing original wording", () => {
    const parsed = parsePersistedDraftValues({
      onboardingVersion: 1,
      values: completeDraft,
    });

    expect(parsed.originalOffering).toBe(completeDraft.originalOffering);
  });

  it("creates a stable, bounded onboarding slug without trusting client input", () => {
    const ownerId = "33f626ce-c620-4ca4-9713-778198449aa1";
    const first = createOnboardingBusinessSlug("Amina's Cakes & More", ownerId);
    const second = createOnboardingBusinessSlug(
      "Amina's Cakes & More",
      ownerId,
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^amina-s-cakes-more-[a-f0-9]{10}$/);
    expect(first.length).toBeLessThanOrEqual(63);
  });
});
