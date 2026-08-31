import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createListingIntentPayload,
  DemoCommitmentNotice,
  listingReturnTo,
  normalizeSearchContext,
} from "@/components/commitment-link";

describe("guest intent payloads", () => {
  it("does not render a submitting form for a fictional demo listing", () => {
    const markup = renderToStaticMarkup(<DemoCommitmentNotice />);
    expect(markup).not.toContain("<form");
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Requests are unavailable for demo listings.");
  });

  it("preserves bounded search context in the authenticated return path", () => {
    expect(
      listingReturnTo(
        "lafia",
        "event-photography",
        "photographer for Saturday",
      ),
    ).toBe("/lafia/listings/event-photography?q=photographer+for+Saturday");
  });

  it("preserves the complete acceptance query through listing and auth handoff", () => {
    const query =
      "I need a birthday cake around Shendam Road tomorrow for under ₦20,000.";
    const returnTo = listingReturnTo("lafia", "made-to-order-cakes", query);
    expect(
      new URL(returnTo, "https://localhub.test").searchParams.get("q"),
    ).toBe(query);
    expect(
      JSON.parse(
        createListingIntentPayload({
          action: "enquire",
          market: "lafia",
          listing: "made-to-order-cakes",
          query,
        }),
      ).search_query,
    ).toBe(query);
  });

  it("sends a bounded, secret-free commitment payload", () => {
    const payload = JSON.parse(
      createListingIntentPayload({
        action: "request-booking",
        market: "lafia",
        listing: "event-photography",
        query: "photographer for Saturday",
      }),
    );
    expect(payload).toEqual({
      type: "listing_commitment",
      market: "lafia",
      listing: "event-photography",
      requested_action: "request-booking",
      search_query: "photographer for Saturday",
    });
  });

  it("carries the authoritative listing id without changing the exact return route", () => {
    const listingId = "66666666-6666-4666-8666-666666666666";
    const routeKey = "lafia-bakes~birthday-cakes";
    const payload = JSON.parse(
      createListingIntentPayload({
        action: "enquire",
        market: "lafia",
        listing: routeKey,
        listingId,
      }),
    );

    expect(listingReturnTo("lafia", routeKey)).toBe(
      `/lafia/listings/${routeKey}`,
    );
    expect(payload).toMatchObject({ listing: routeKey, listing_id: listingId });
  });

  it("removes control characters and bounds query context", () => {
    expect(normalizeSearchContext(`cake\u0000${"x".repeat(200)}`)).toHaveLength(
      160,
    );
  });
});
