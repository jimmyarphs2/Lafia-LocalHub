import { describe, expect, it } from "vitest";

import {
  matchOnboardingCategory,
  normalizeOfferingWording,
  suggestOnboardingCategories,
} from "@/lib/onboarding/category-intelligence";

describe("vendor category intelligence", () => {
  it("maps a cake baker to food and catering deterministically", () => {
    const match = matchOnboardingCategory(
      "I am a baker making cakes and small chops",
    );

    expect(match.category.slug).toBe("food-catering");
    expect(match.confidence).toBe("high");
    expect(match.matchedTerms).toEqual(
      expect.arrayContaining(["baker", "cakes", "small chops"]),
    );
  });

  it("maps phone repair to the service-shaped electronics category", () => {
    const match = matchOnboardingCategory("Phone repair");

    expect(match.category.slug).toBe("electronics-repair");
    expect(match.category.listingKind).toBe("service");
    expect(match.score).toBe(1);
  });

  it("maps a photographer without needing an AI call", () => {
    const [first, ...rest] = suggestOnboardingCategories(
      "Photographer for weddings and naming ceremonies",
    );

    expect(first.category.slug).toBe("photography-media");
    expect(rest.every((suggestion) => suggestion.score <= first.score)).toBe(
      true,
    );
  });

  it("never blocks an unknown local African trade and preserves its wording", () => {
    const wording = "  I repair talking drums for cultural groups in Keffi  ";
    const match = matchOnboardingCategory(wording);

    expect(match.category.slug).toBe("other-local-trade");
    expect(match.confidence).toBe("unknown");
    expect(match.originalWording).toBe(
      "I repair talking drums for cultural groups in Keffi",
    );
    expect(match.normalizedWording).toBe(
      "i repair talking drums for cultural groups in keffi",
    );
  });

  it("normalizes punctuation, accents and spacing consistently", () => {
    expect(normalizeOfferingWording("  Cakés &   CATERING!!! ")).toBe(
      "cakes and catering",
    );
  });
});
