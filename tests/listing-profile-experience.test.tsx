/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ListingProfileExperience } from "@/components/listing-profile-experience";
import {
  categories,
  listings,
  LIVE_SUPABASE_PROVENANCE,
  type Listing,
  type Vendor,
  vendors,
} from "@/lib/catalog/data";

const demoListing = listings[0]!;
const demoVendor = vendors[0]!;

afterEach(cleanup);

function renderProfile(
  listing: Listing,
  vendor: Vendor,
  relatedListings: readonly Listing[] = listings.slice(1, 3),
) {
  return render(profile(listing, vendor, relatedListings));
}

function profile(
  listing: Listing,
  vendor: Vendor,
  relatedListings: readonly Listing[] = listings.slice(1, 3),
) {
  return (
    <ListingProfileExperience
      action="enquire"
      category={categories[0]}
      isDirectOrderAvailable={false}
      listing={listing}
      market="lafia"
      orderRecovery={null}
      relatedListings={relatedListings}
      requestRecovery={null}
      searchQuery="birthday cake"
      vendor={vendor}
    />
  );
}

describe("ListingProfileExperience", () => {
  it("renders a photographic, explicitly fictional browsing-only profile", () => {
    const { container } = renderProfile(demoListing, demoVendor);

    expect(screen.getByText("Fictional LocalHub demo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Requests unavailable in demo" }),
    ).toBeDisabled();
    expect(screen.getByText("Browsing-only demonstration")).toBeInTheDocument();
    expect(container.querySelectorAll("img").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/4\.8|92 reviews|open now/i);
  });

  it("keeps live directory claims fail-closed while exposing the quote path", () => {
    const liveListing: Listing = {
      ...demoListing,
      slug: "birthday-cake",
      routeKey: "lafia-bakes~birthday-cake",
      provenance: LIVE_SUPABASE_PROVENANCE,
      priceNote: "From the published listing",
    };
    const liveVendor: Vendor = {
      ...demoVendor,
      slug: "lafia-bakes",
      name: "Lafia Bakes",
      provenance: LIVE_SUPABASE_PROVENANCE,
    };

    renderProfile(liveListing, liveVendor, []);

    expect(screen.getByText("Published directory listing")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Ask for a quote" }),
    ).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Directions" })).toHaveAttribute(
      "rel",
      "noreferrer",
    );
    expect(document.body.textContent).not.toMatch(/verified|rating:|reviews:/i);
  });

  it("supports local save feedback without requiring sign-in", () => {
    renderProfile(demoListing, demoVendor);

    const save = screen.getByRole("button", { name: "Save listing" });
    fireEvent.click(save);

    expect(save).toHaveAttribute("aria-pressed", "true");
    expect(save).toHaveAccessibleName("Remove saved listing");
    expect(
      screen.getByText("Listing saved on this device."),
    ).toBeInTheDocument();
  });

  it("keeps the document title populated across related-listing navigation", () => {
    const view = renderProfile(demoListing, demoVendor);

    expect(document.title).toBe(demoListing.title + " in lafia");

    const relatedListing = listings[1]!;
    view.rerender(profile(relatedListing, demoVendor));

    expect(document.title).toBe(relatedListing.title + " in lafia");
  });

  it("renders recovery guidance without implying order or booking success", () => {
    render(
      <ListingProfileExperience
        action="request-booking"
        category={categories[5]}
        isDirectOrderAvailable={false}
        listing={listings[3]!}
        market="lafia"
        orderRecovery="unavailable"
        relatedListings={listings.slice(4, 6)}
        requestRecovery="expired"
        searchQuery="photographer"
        vendor={vendors[3]}
      />,
    );

    expect(screen.getByText(/saved request expired/i)).toBeInTheDocument();
    expect(
      screen.getByText(/could not continue that order/i),
    ).toBeInTheDocument();
    expect(document.body.textContent).toContain(
      "A request is not an order, booking, or payment.",
    );
  });
});
