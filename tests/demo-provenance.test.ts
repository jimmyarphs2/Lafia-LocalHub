import { describe, expect, it } from "vitest";
import {
  FICTIONAL_DEMO_PROVENANCE,
  filterCatalogRecordsForMode,
  isPublishableCatalogRecord,
  listings,
  vendors,
} from "@/lib/catalog/data";

describe("fictional demo provenance", () => {
  it("provides 12–20 distinct fictional Lafia businesses", () => {
    expect(vendors.length).toBeGreaterThanOrEqual(12);
    expect(vendors.length).toBeLessThanOrEqual(20);
    expect(new Set(vendors.map(({ slug }) => slug)).size).toBe(vendors.length);
    expect(vendors).toHaveLength(18);
  });

  it("labels every vendor and listing with the explicit non-verified contract", () => {
    for (const record of [...vendors, ...listings]) {
      expect(record.provenance).toEqual(FICTIONAL_DEMO_PROVENANCE);
      expect(record.provenance.verifiedBusiness).toBe(false);
      expect(isPublishableCatalogRecord(record)).toBe(false);
    }
    expect(vendors.every(({ name }) => name.includes("(Demo)"))).toBe(true);
  });

  it("contains no fabricated rating, review, popularity, stock, demand, or sales fields", () => {
    const forbidden = [
      "rating",
      "ratings",
      "review",
      "reviews",
      "popularity",
      "stock",
      "demand",
      "sales",
    ];
    for (const record of [...vendors, ...listings]) {
      expect(
        Object.keys(record).filter((key) => forbidden.includes(key)),
      ).toEqual([]);
    }
  });

  it("removes every fictional record from live-mode catalog sources", () => {
    expect(filterCatalogRecordsForMode(vendors, false)).toEqual([]);
    expect(filterCatalogRecordsForMode(listings, false)).toEqual([]);
    expect(filterCatalogRecordsForMode(vendors, true)).toHaveLength(18);
  });
});
