import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), ...path.split("/")), "utf8");

const publicCatalogPages = [
  "app/[market]/page.tsx",
  "app/[market]/categories/[category]/page.tsx",
  "app/[market]/search/page.tsx",
  "app/[market]/listings/[listing]/page.tsx",
  "app/[market]/vendors/[vendor]/page.tsx",
] as const;

describe("catalog publication boundary", () => {
  it("loads every public catalog surface through the server source selector", () => {
    for (const path of [...publicCatalogPages, "app/sitemap.ts"] as const) {
      const source = read(path);

      expect(source).toContain("getCatalogForMarket");
      expect(source).toMatch(/await getCatalogForMarket\(/);
      expect(source).not.toContain("filterCatalogRecordsForMode");
      expect(source).not.toMatch(
        /\bget(?:Category|Listing|Vendor|VendorListings)\s*\(/,
      );
    }
  });

  it("noindexes unavailable detail states and rejects records absent from the selected source", () => {
    for (const path of [
      "app/[market]/listings/[listing]/page.tsx",
      "app/[market]/vendors/[vendor]/page.tsx",
    ]) {
      const source = read(path);

      expect(source).toContain('catalog.state !== "ready"');
      expect(source).toContain("robots: { index: false, follow: false }");
      expect(source).toMatch(
        /const (listing|vendor) = catalog\.(listings|vendors)\.find/,
      );
      expect(source).toMatch(/if \(!(listing|vendor)\) notFound\(\)/);
    }
  });

  it("derives detail-page provenance copy from the record", () => {
    for (const path of [
      "app/[market]/listings/[listing]/page.tsx",
      "app/[market]/vendors/[vendor]/page.tsx",
    ]) {
      expect(read(path)).toContain('provenance?.kind === "fictional-demo"');
    }
  });

  it("never publishes fictional demo records in the sitemap", () => {
    expect(read("app/sitemap.ts")).toContain(
      'catalog.source === "fictional-demo"',
    );
  });
});
