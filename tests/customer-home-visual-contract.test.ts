import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("customer home visual trust boundary", () => {
  it("renders the local market hero as application artwork", () => {
    const page = read("app/[market]/page.tsx");

    expect(page).toContain(
      '<div aria-hidden="true" className="home-hero-image" />',
    );
  });

  it("keeps night-mode search text and unavailable states readable", () => {
    const css = read("app/globals.css");

    expect(css).toMatch(/\.search-form input\s*\{\s*color: #071a38;/);
    expect(css).toMatch(
      /\.empty-state\s*\{[\s\S]*?color: var\(--ink\);[\s\S]*?background: var\(--surface-raised\);/,
    );
  });

  it("ships optimized local demo artwork rather than remote runtime assets", () => {
    for (const filename of [
      "localhub-demo-market-hero.webp",
      "localhub-demo-cake.webp",
      "localhub-demo-photographer.webp",
      "localhub-demo-electrical.webp",
    ]) {
      const path = resolve(process.cwd(), "public", "images", filename);
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).size).toBeLessThan(200_000);
    }
  });
});
