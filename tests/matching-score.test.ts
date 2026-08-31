import { describe, expect, it } from "vitest";
import { listings } from "@/lib/catalog/data";
import { parseSearchIntent } from "@/lib/catalog/search";
import { MATCH_WEIGHTS, scoreListing } from "@/lib/matching/score";

describe("transparent match scoring", () => {
  it("publishes the approved baseline weights", () => {
    expect(MATCH_WEIGHTS).toEqual({
      relevance: 35,
      availability: 20,
      distance: 20,
      budget: 15,
      merchantRating: 10,
    });
  });

  it("renormalizes missing evidence without inventing a merchant rating", () => {
    const listing = listings.find(
      (candidate) => candidate.slug === "made-to-order-cakes",
    );
    expect(listing).toBeDefined();
    const match = scoreListing(
      parseSearchIntent("cake under ₦10,000"),
      listing!,
    );
    expect(match.score).toBe(87);
    expect(match.missingEvidence).toEqual(
      expect.arrayContaining(["availability", "distance", "merchantRating"]),
    );
    expect(
      match.components.find(
        (component) => component.dimension === "merchantRating",
      ),
    ).toMatchObject({ score: null, baselineWeight: 10 });
    expect(match.scoreNotice).toContain("not a probability");
  });

  it("keeps the final product score in the inclusive 0–100 range", () => {
    const intent = parseSearchIntent(
      "I need a birthday cake around Shendam Road tomorrow for under ₦20,000.",
    );
    for (const listing of listings) {
      const { score } = scoreListing(intent, listing);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(score)).toBe(true);
    }
  });

  it("uses listing evidence language for publishable records", () => {
    const demoListing = listings.find(
      (candidate) => candidate.slug === "made-to-order-cakes",
    );
    expect(demoListing).toBeDefined();
    const liveListing = {
      ...demoListing!,
      provenance: undefined,
    } as unknown as typeof demoListing;
    const match = scoreListing(
      parseSearchIntent("cake tomorrow for under ₦20,000"),
      liveListing!,
    );

    expect(match.scoreNotice).toContain("listing evidence");
    expect(match.scoreNotice).not.toContain("fictional demo");
    expect(
      match.components.map((component) => component.reason).join(" "),
    ).not.toContain("demo");
  });
});
