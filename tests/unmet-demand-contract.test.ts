import { describe, expect, it } from "vitest";

import {
  demandConfirmationPath,
  deriveUnmetDemandCaptureCandidate,
  parseDemandConfirmationPath,
  parseUnmetDemandRecordResult,
} from "@/lib/demand/contract";

const marketId = "11111111-1111-4111-8111-111111111111";
const categoryId = "22222222-2222-4222-8222-222222222222";
const otherCategoryId = "33333333-3333-4333-8333-333333333333";

function eligibleInput() {
  return {
    source: "supabase" as const,
    state: "ready" as const,
    complete: true,
    market: { id: marketId, slug: "lafia" },
    categories: [{ id: categoryId, marketId, slug: "bakers" }],
    listings: [] as Array<{ categoryId?: string }>,
    intent: {
      raw: "private birthday cake request under 30k tomorrow",
      normalized: "private birthday cake request under 30k tomorrow",
      categoryIds: [categoryId],
      categorySlugs: ["bakers"],
      capabilityTags: ["birthday-cake"],
      budgetNaira: 30_000,
      location: "private-area",
      time: "tomorrow" as const,
    },
    resultCount: 0,
  };
}

describe("privacy-bounded unmet-demand capture", () => {
  it("derives only the canonical market slug and one category UUID", () => {
    const candidate = deriveUnmetDemandCaptureCandidate(eligibleInput());

    expect(candidate).toEqual({ marketSlug: "lafia", categoryId });
    expect(Object.keys(candidate ?? {}).sort()).toEqual([
      "categoryId",
      "marketSlug",
    ]);
    expect(JSON.stringify(candidate)).not.toMatch(
      /private|birthday|30|tomorrow|capabil|budget|location|query/i,
    );
  });

  it.each([
    ["fictional demo", { source: "fictional-demo" as const }],
    ["unavailable", { state: "unavailable" as const }],
    ["bounded catalog", { complete: false }],
    ["positive result", { resultCount: 1 }],
    ["empty query", { intent: { ...eligibleInput().intent, normalized: "" } }],
    [
      "unknown category",
      {
        intent: {
          ...eligibleInput().intent,
          categoryIds: [],
          categorySlugs: [],
        },
      },
    ],
    [
      "multiple categories",
      {
        intent: {
          ...eligibleInput().intent,
          categoryIds: [categoryId, otherCategoryId],
          categorySlugs: ["bakers", "caterers"],
        },
      },
    ],
    [
      "foreign category",
      {
        categories: [
          {
            id: categoryId,
            marketId: "44444444-4444-4444-8444-444444444444",
            slug: "bakers",
          },
        ],
      },
    ],
    ["category already supplied", { listings: [{ categoryId }] }],
  ])("rejects %s evidence", (_label, overrides) => {
    expect(
      deriveUnmetDemandCaptureCandidate({
        ...eligibleInput(),
        ...overrides,
      }),
    ).toBeNull();
  });

  it("does not treat supply in another category as this category's supply", () => {
    expect(
      deriveUnmetDemandCaptureCandidate({
        ...eligibleInput(),
        listings: [{ categoryId: otherCategoryId }],
      }),
    ).toEqual({ marketSlug: "lafia", categoryId });
  });

  it("builds and parses an exact query-free internal confirmation path", () => {
    const path = demandConfirmationPath("lafia", categoryId);

    expect(path).toBe(`/lafia/demand/confirm?category=${categoryId}`);
    expect(parseDemandConfirmationPath(path)).toEqual({
      marketSlug: "lafia",
      categoryId,
    });
    for (const malformed of [
      `//attacker.example/demand/confirm?category=${categoryId}`,
      `/Lafia/demand/confirm?category=${categoryId}`,
      `/lafia/demand/confirm?category=not-a-uuid`,
      `/lafia/demand/confirm?category=${categoryId}&q=private`,
      `/lafia/demand/confirm?category=${categoryId}#private`,
    ]) {
      expect(parseDemandConfirmationPath(malformed)).toBeNull();
    }
  });

  it("accepts only the literal, error-free RPC success value", () => {
    expect(parseUnmetDemandRecordResult(true, null)).toEqual({
      accepted: true,
    });
    for (const value of [false, null, undefined, 1, "true", [true], {}]) {
      expect(parseUnmetDemandRecordResult(value, null)).toBeNull();
    }
    expect(parseUnmetDemandRecordResult(true, new Error("network"))).toBeNull();
  });
});
