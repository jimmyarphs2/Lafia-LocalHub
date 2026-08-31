import { describe, expect, it } from "vitest";
import {
  describeIntent,
  parseSearchIntent,
  searchListings,
} from "@/lib/catalog/search";

const cakeQuery =
  "I need a birthday cake around Shendam Road tomorrow for under ₦20,000.";
const photographerQuery =
  "I need a photographer for my introduction ceremony next Saturday. Budget ₦80,000.";

describe("deterministic catalog search", () => {
  it("extracts category, capability, budget, area and relative time", () => {
    const intent = parseSearchIntent(cakeQuery);
    expect(intent.categorySlugs).toContain("food-restaurants");
    expect(intent.capabilityTags).toEqual(
      expect.arrayContaining(["cake", "birthday-cake"]),
    );
    expect(intent.budgetNaira).toBe(20_000);
    expect(intent.location).toBe("shendam road");
    expect(intent.time).toBe("tomorrow");
    expect(describeIntent(intent)).toContain("₦20,000");
  });

  it("returns exactly three fictional cake businesses for the acceptance query", () => {
    const { matches } = searchListings(cakeQuery, "lafia");
    expect(matches).toHaveLength(3);
    expect(new Set(matches.map(({ listing }) => listing.vendor)).size).toBe(3);
    expect(
      matches.every(({ listing }) =>
        listing.capabilityTags.includes("birthday-cake"),
      ),
    ).toBe(true);
  });

  it("returns exactly four photographer profiles for the acceptance query", () => {
    const { intent, matches } = searchListings(photographerQuery, "lafia");
    expect(intent.time).toBe("next-saturday");
    expect(intent.budgetNaira).toBe(80_000);
    expect(matches).toHaveLength(4);
    expect(
      matches.every(({ listing }) => listing.category === "photography"),
    ).toBe(true);
  });

  it.each([
    ["Phone repair near me", "electronics", 2],
    ["Quiet restaurant for dinner tonight", "food-restaurants", 2],
    ["30KVA generator around Lafia", "equipment-hire", 2],
  ])("matches %s without AI or maps", (query, category, count) => {
    const { matches } = searchListings(query, "lafia");
    expect(matches).toHaveLength(count);
    expect(matches.every(({ listing }) => listing.category === category)).toBe(
      true,
    );
  });

  it("matches aliases only as complete tokens or phrases", () => {
    const intent = parseSearchIntent("great plumber");
    expect(intent.categorySlugs).toContain("home-services");
    expect(intent.categorySlugs).not.toContain("food-restaurants");
  });

  it("keeps unmatched demand structured and free of arbitrary query text", () => {
    const result = searchListings("custom aquarium installation", "lafia");
    expect(result.results).toEqual([]);
    expect(result.unmatchedDemand).toEqual({
      type: "unmet_demand",
      version: 1,
      market: "lafia",
      recognized: {
        categories: [],
        capabilities: [],
        budgetCeilingNaira: undefined,
        area: undefined,
        relativeTime: undefined,
      },
    });
    expect(JSON.stringify(result.unmatchedDemand)).not.toContain("aquarium");
    expect(JSON.stringify(result.unmatchedDemand)).not.toContain(
      "search_query",
    );
  });

  it("preserves the route market in unmatched-demand handoffs", () => {
    const result = searchListings("custom aquarium installation", "keffi");

    expect(result.unmatchedDemand?.market).toBe("keffi");
  });
});
