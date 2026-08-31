import { describe, expect, it } from "vitest";

import {
  parseListingRequest,
  parseRequestIntentContext,
} from "@/lib/requests/contract";
import { parseGuestIntentClaim } from "@/lib/requests/guest-claim";

const id = "66666666-6666-4666-8666-666666666666";

describe("listing request presentation boundaries", () => {
  it("accepts only explicit request statuses and valid timestamps", () => {
    expect(
      parseListingRequest({
        id,
        request_number: "LR-260830-0000000001",
        listing_id: id,
        requested_action: "enquire",
        status: "open",
        created_at: "2026-08-30T10:00:00.000Z",
      }),
    ).toMatchObject({ status: "open" });
    expect(
      parseListingRequest({
        id,
        request_number: "bad-number",
        listing_id: id,
        requested_action: "enquire",
        status: "invented",
        created_at: "not-a-date",
      }),
    ).toBeNull();
  });

  it("keeps route authority and existing request identity in the safe intent context", () => {
    expect(
      parseRequestIntentContext({
        id,
        listing_id: id,
        market_slug: "lafia",
        listing_route: "vendor~cake",
        listing_title: "Cake",
        vendor_name: "Vendor",
        requested_action: "enquire",
        expires_at: "2026-08-30T10:15:00.000Z",
        request_id: id,
        request_number: "LR-260830-0000000001",
        request_status: "matched",
        request_created_at: "2026-08-30T10:00:00.000Z",
      }),
    ).toMatchObject({
      marketSlug: "lafia",
      listingRoute: "vendor~cake",
      existingRequestId: id,
      requestStatus: "matched",
    });
  });

  it("never treats a foreign same-capability claim outcome as retryable", () => {
    expect(
      parseGuestIntentClaim(
        {
          outcome: "claimed_by_other",
          return_to: "/lafia/listings/vendor~cake/request",
        },
        null,
      ),
    ).toEqual({
      state: "terminal",
      returnTo: "/lafia/listings/vendor~cake/request",
    });
  });

  it("accepts only typed claim success outcomes and kinds", () => {
    expect(
      parseGuestIntentClaim(
        {
          outcome: "replayed",
          kind: "listing_request",
          return_to: "/lafia/listings/vendor~cake/request",
        },
        null,
      ),
    ).toMatchObject({ state: "claimed", kind: "listing_request" });
    expect(
      parseGuestIntentClaim(
        {
          outcome: "claimed",
          kind: "unexpected",
          return_to: "/lafia",
        },
        null,
      ),
    ).toEqual({ state: "transient" });
    expect(
      parseGuestIntentClaim(
        {
          outcome: "unknown",
          kind: "listing_request",
          return_to: "/lafia/listings/vendor~cake/request",
        },
        null,
      ),
    ).toEqual({ state: "transient" });
    expect(
      parseGuestIntentClaim(
        {
          outcome: "claimed",
          kind: "continue",
          return_to: "//attacker.example",
        },
        null,
      ),
    ).toEqual({ state: "transient" });
  });

  it("rejects malformed IDs and noncanonical routes in intent context", () => {
    expect(
      parseRequestIntentContext({
        id: "not-a-uuid",
        listing_id: id,
        market_slug: "Lafia",
        listing_route: "vendor/cake",
        listing_title: "Cake",
        vendor_name: "Vendor",
        requested_action: "enquire",
        expires_at: "2026-08-30T10:15:00.000Z",
      }),
    ).toBeNull();
  });
});
