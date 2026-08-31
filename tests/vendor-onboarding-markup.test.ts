import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("vendor onboarding form semantics", () => {
  it("renders sibling onboarding and ALE forms without nesting", () => {
    const wizard = readFileSync(
      resolve(process.cwd(), "components/vendor/onboarding-wizard.tsx"),
      "utf8",
    );
    const listingStarter = readFileSync(
      resolve(process.cwd(), "components/vendor/ale-listing-starter.tsx"),
      "utf8",
    );

    expect(wizard).toContain("<AleListingStarter");
    expect(wizard.match(/<form\b/g)).toHaveLength(1);
    expect(wizard.match(/<\/form>/g)).toHaveLength(1);
    expect(listingStarter.match(/<form\b/g)).toHaveLength(1);
    expect(listingStarter.match(/<\/form>/g)).toHaveLength(1);
    expect(wizard.indexOf("</form>")).toBeLessThan(
      wizard.indexOf("<AleListingStarter"),
    );
  });

  it("uses native onboarding submission for Enter-to-continue", () => {
    const wizard = readFileSync(
      resolve(process.cwd(), "components/vendor/onboarding-wizard.tsx"),
      "utf8",
    );

    expect(wizard).toContain("<form onSubmit={submitOnboarding}>");
    expect(wizard).toContain('type="submit"');
    expect(wizard).toContain("if (!isSaving && !completed) void goForward();");
  });

  it("does not offer unsupported edits after terminal submission", () => {
    const wizard = readFileSync(
      resolve(process.cwd(), "components/vendor/onboarding-wizard.tsx"),
      "utf8",
    );

    expect(wizard).toContain("Submitted details are locked after completion.");
    expect(wizard).not.toContain("Edit details");
    expect(wizard).not.toContain("setCompleted(false)");
  });
});
