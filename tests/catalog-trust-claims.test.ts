import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { LIVE_SUPABASE_PROVENANCE } from "@/lib/catalog/data";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), ...path.split("/")), "utf8");

const publicCatalogSurfaces = [
  "app/layout.tsx",
  "app/[market]/layout.tsx",
  "app/[market]/page.tsx",
  "app/[market]/search/page.tsx",
  "app/[market]/categories/[category]/page.tsx",
  "app/[market]/demand/confirm/page.tsx",
  "app/[market]/vendors/[vendor]/page.tsx",
  "components/catalog-ui.tsx",
  "components/market-footer.tsx",
] as const;

describe("public catalog trust claims", () => {
  it("keeps live provenance fail-closed without a verification model", () => {
    expect(LIVE_SUPABASE_PROVENANCE.verifiedBusiness).toBe(false);
  });

  it("does not market published catalog records as verified", () => {
    for (const path of publicCatalogSurfaces) {
      expect(read(path)).not.toMatch(/\bverified\b/i);
    }
  });
});
