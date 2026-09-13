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

  it.each([
    ["Office chair within 45k", 45_000],
    ["Office chair within NGN 45,000", 45_000],
    ["Birthday cake no more than 20 thousand", 20_000],
    ["Birthday cake that costs up to ₦20,000", 20_000],
    ["Office chairs that cost up to 45.5k", 45_500],
  ])("understands the conversational budget in %s", (query, budget) => {
    const intent = parseSearchIntent(query);

    expect(intent.budgetNaira).toBe(budget);
    for (const filler of ["within", "cost", "costs", "thousand"]) {
      expect(intent.terms).not.toContain(filler);
    }
  });

  it("supports the entry birthday-cake suggestion without inventing a location", () => {
    const { intent, matches } = searchListings(
      "Birthday cake under ₦20,000 near me",
      "lafia",
    );

    expect(intent.budgetNaira).toBe(20_000);
    expect(intent.capabilityTags).toContain("birthday-cake");
    expect(intent.locationCoordinates).toBeUndefined();
    expect(matches).toHaveLength(3);
  });

  it("recognizes phone repair in the conversational entry suggestion", () => {
    const { intent, matches } = searchListings(
      "Who can fix my phone today?",
      "lafia",
    );

    expect(intent.capabilityTags).toContain("phone-repair");
    expect(intent.categorySlugs).toContain("electronics");
    expect(intent.time).toBe("today");
    expect(intent.terms).toEqual(["fix", "phone"]);
    expect(matches).toHaveLength(2);
    expect(
      matches.every(({ listing }) =>
        listing.capabilityTags.includes("phone-repair"),
      ),
    ).toBe(true);
  });

  it("retains product and delivery details from the entry office-chair suggestion", () => {
    const intent = parseSearchIntent(
      "Office chair within ₦45,000, delivered this week",
    );

    expect(intent.budgetNaira).toBe(45_000);
    expect(intent.terms).toEqual(["office", "chair", "delivered", "week"]);
    expect(intent.time).toBeUndefined();
    expect(intent.locationCoordinates).toBeUndefined();
  });

  it("ignores conversational filler while retaining the requested product", () => {
    expect(
      parseSearchIntent("Could you please find me an office chair?").terms,
    ).toEqual(["office", "chair"]);
  });

  it("continues to rank over-budget matches instead of silently filtering them", () => {
    const { intent, matches } = searchListings(
      "Birthday cake no more than ₦1",
      "lafia",
    );

    expect(intent.budgetNaira).toBe(1);
    expect(matches).toHaveLength(3);
    expect(
      matches.every((match) =>
        match.components.some(
          (component) =>
            component.dimension === "budget" && component.score === 0,
        ),
      ),
    ).toBe(true);
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
