// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { VendorMediaUploader } from "@/components/vendor/media/vendor-media-uploader";

afterEach(cleanup);

const listings = [
  {
    id: "5e5e77cd-45dc-4f36-9a1f-314cad75f5db",
    status: "draft",
    title: "Amina's celebration cakes",
  },
];

const multipleListings = [
  ...listings,
  {
    id: "c3dd5d0a-40dc-4922-8767-b0e681efcdb2",
    status: "draft",
    title: "Ikenna's event photography",
  },
];

describe("vendor media picker accessibility", () => {
  it("selects a permitted requested draft instead of the first draft", () => {
    render(
      <VendorMediaUploader
        initialListingId={multipleListings[1].id}
        listings={multipleListings}
        providerState="ready"
      />,
    );

    expect(screen.getByLabelText("Listing")).toHaveValue(
      multipleListings[1].id,
    );
  });

  it("keeps each focusable input inside its visible focus-within control", () => {
    render(<VendorMediaUploader listings={listings} providerState="ready" />);

    const fileInput = screen.getByLabelText("Choose file");
    const cameraInput = screen.getByLabelText("Take photo");
    const fileControl = fileInput.closest("label");
    const cameraControl = cameraInput.closest("label");

    expect(fileControl).not.toBeNull();
    expect(cameraControl).not.toBeNull();

    fileInput.focus();
    expect(fileInput).toHaveFocus();
    expect(fileControl).toContainElement(document.activeElement as HTMLElement);

    cameraInput.focus();
    expect(cameraInput).toHaveFocus();
    expect(cameraControl).toContainElement(
      document.activeElement as HTMLElement,
    );
    expect(cameraInput).toHaveAttribute("capture", "environment");
  });

  it("retains visible focus-within outlines for both label controls", () => {
    const css = readFileSync(
      join(
        process.cwd(),
        "components",
        "vendor",
        "media",
        "vendor-media.module.css",
      ),
      "utf8",
    );

    expect(css).toMatch(/\.pickerButton:focus-within/);
    expect(css).toMatch(/\.cameraButton:focus-within/);
  });
});
