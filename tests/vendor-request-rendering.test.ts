import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("vendor request response rendering boundaries", () => {
  it("uses presentation copy instead of raw internal request statuses", () => {
    const vendor = read("app/vendor/requests/page.tsx");
    const customerList = read("app/[market]/requests/page.tsx");
    const customerDetail = read("app/[market]/requests/[request]/page.tsx");
    const contract = read("lib/requests/contract.ts");

    expect(contract).toContain("Waiting for vendor response");
    expect(contract).toContain("Vendor accepted for follow-up");
    expect(contract).toContain("Vendor declined");
    for (const page of [vendor, customerList, customerDetail]) {
      expect(page).toContain("presentListingRequestStatus");
      expect(page).not.toContain("· {request.status}");
      expect(page).not.toContain("<strong>{result.request.status}</strong>");
    }
  });

  it("keeps vendor decisions scoped to follow-up and has only layout-owned main landmarks", () => {
    const vendor = read("app/vendor/requests/page.tsx");
    const controls = read("components/vendor/request-decision-controls.tsx");
    const customerList = read("app/[market]/requests/page.tsx");
    const customerDetail = read("app/[market]/requests/[request]/page.tsx");

    expect(vendor).toContain(
      "does not\n        create a booking, order, payment",
    );
    expect(controls).toContain('aria-label="Respond to customer request"');
    expect(controls).toContain('role="status"');
    expect(controls).toContain('role="alert"');
    expect(controls).toContain('status !== "open"');
    expect(customerList).toContain("Track vendor responses to your requests");
    expect(customerList).toContain(
      "does not create a booking, payment, or order",
    );
    expect(customerDetail).toContain("follow-up only");
    for (const page of [vendor, customerList, customerDetail]) {
      expect(page).not.toContain("<main");
    }
  });
});
