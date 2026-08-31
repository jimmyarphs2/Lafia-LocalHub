import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608300018_localhub_market_integrity_trigger_dispatch.sql",
  ),
  "utf8",
);

describe("market integrity trigger dispatch repair", () => {
  it("dispatches before evaluating table-specific NEW fields", () => {
    expect(migration).toContain("case tg_table_name");
    for (const table of [
      "market_locations",
      "categories",
      "category_aliases",
      "category_listing_type_mappings",
      "businesses",
      "listings",
      "requests",
      "demand_signals",
      "unmet_demand",
      "search_intents",
      "orders",
      "order_items",
    ]) {
      expect(migration).toContain(`when '${table}' then`);
    }
    const body = migration.slice(migration.indexOf("as $$"));
    expect(body).not.toMatch(/tg_table_name\s*=.*\band\s+new\./);
  });

  it("preserves every integrity failure and rejects unexpected attachments", () => {
    for (const message of [
      "location parent is invalid",
      "category parent is invalid",
      "category alias market mismatch",
      "category mapping schema mismatch",
      "business location market mismatch",
      "listing business market mismatch",
      "listing location market mismatch",
      "listing category market mismatch",
      "listing schema type mismatch",
      "listing category schema mapping mismatch",
      "category market mismatch",
      "search intent category market mismatch",
      "order business market mismatch",
      "order item listing mismatch",
      "order item variant mismatch",
    ]) {
      expect(migration).toContain(message);
    }
    expect(migration).toContain(
      "validate_market_integrity cannot validate table %",
    );
    expect(migration).toContain(
      "validate_market_integrity cannot validate schema %",
    );
  });
});
