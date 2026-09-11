import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ListingCard, ListingMatchRows } from "@/components/catalog-ui";
import { listings, type Listing } from "@/lib/catalog/data";
import { parseSearchIntent } from "@/lib/catalog/search";
import { scoreListing } from "@/lib/matching/score";

const demoListing = listings[0]!;
const publishableListing = {
  ...demoListing,
  provenance: undefined,
} as unknown as Listing;

describe("catalog UI provenance", () => {
  it("does not label publishable listing cards as fictional demo data", () => {
    const markup = renderToStaticMarkup(
      <ListingCard market="lafia" listing={publishableListing} />,
    );

    expect(markup).toContain("Directory listing");
    expect(markup).not.toContain("Fictional demo listing");
    expect(markup).not.toContain("localhub-demo-cake.webp");
  });

  it("uses the collision-free live route key while preserving the record slug", () => {
    const listing = {
      ...publishableListing,
      slug: "birthday-cakes",
      routeKey: "lafia-bakes~birthday-cakes",
    };
    const markup = renderToStaticMarkup(
      <ListingCard market="lafia" listing={listing} />,
    );

    expect(markup).toContain(
      'href="/lafia/listings/lafia-bakes~birthday-cakes"',
    );
    expect(listing.slug).toBe("birthday-cakes");
  });

  it("does not label publishable match evidence as fictional demo data", () => {
    const match = scoreListing(
      parseSearchIntent("cake tomorrow under ₦20,000"),
      publishableListing,
    );
    const markup = renderToStaticMarkup(
      <ListingMatchRows market="lafia" matches={[match]} query="cake" />,
    );

    expect(markup).toContain("Listing evidence");
    expect(markup).not.toContain("Fictional demo evidence");
  });

  it("retains explicit fictional-demo labels for seeded records", () => {
    const markup = renderToStaticMarkup(
      <ListingCard market="lafia" listing={demoListing} />,
    );

    expect(markup).toContain("Fictional demo listing");
    expect(markup).toContain("localhub-demo-cake.webp");
  });
});
