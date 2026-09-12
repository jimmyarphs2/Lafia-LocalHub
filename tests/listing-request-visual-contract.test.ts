import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("listing request visual contract", () => {
  it("preserves authentication, ownership, and request safety boundaries", () => {
    const page = read("app/[market]/listings/[listing]/request/page.tsx");

    expect(page).toContain("getServerSupabaseClient");
    expect(page).toContain("getListingRequestIntent");
    expect(page).toContain("requestContext.marketSlug !== market");
    expect(page).toContain("requestContext.listingRoute !== listingRoute");
    expect(page).toContain("existingRequestId");
    expect(page).toContain("not an order, booking");
    expect(page).toContain("Do not include card or bank details");
  });

  it("keeps the profile truthful and the guest quote path explicit", () => {
    const page = read("app/[market]/listings/[listing]/page.tsx");
    const profile = read("components/listing-profile-experience.tsx");

    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).not.toContain('export const dynamic = "force-static"');
    expect(profile).toContain("Fictional LocalHub demo");
    expect(profile).toContain("Published directory listing");
    expect(profile).toContain("Requests unavailable in demo");
    expect(profile).toContain('label="Ask for a quote"');
    expect(profile).toContain('referrerPolicy="no-referrer"');
    expect(profile).not.toContain("LocalHub Verified");
    expect(profile).not.toContain("4.8");
    expect(profile).not.toContain("92 reviews");
  });
});
