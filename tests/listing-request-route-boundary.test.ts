import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("listing request route boundaries", () => {
  it("validates forged action route values before redirect construction", () => {
    const action = read("app/[market]/listings/[listing]/request/actions.ts");
    const intent = read(
      "app/[market]/listings/[listing]/request/intent/route.ts",
    );
    expect(action).toContain("marketSlugSchema.safeParse");
    expect(action).toContain("listingRouteSchema.safeParse");
    expect(intent).toContain("marketSlugSchema.safeParse(market)");
    expect(intent).toContain("listingRouteSchema.safeParse(listingSlug)");
  });

  it("uses only a terminal request segment for recovery paths", () => {
    const navigation = read("lib/orders/navigation.ts");
    expect(navigation).toContain('segments[3] === "request"');
    expect(navigation).toContain('slice(0, -"/request".length)');
    expect(navigation).not.toContain('indexOf("/request")');
  });

  it("provides a labelled bounded confirmation form and a pending-safe submit button", () => {
    const confirmation = read(
      "app/[market]/listings/[listing]/request/page.tsx",
    );
    const submit = read("components/request-submit-button.tsx");
    expect(confirmation).toContain('htmlFor="request-details"');
    expect(confirmation).toContain('aria-describedby="request-details-help"');
    expect(confirmation).toContain("maxLength={2000}");
    expect(confirmation).toContain('role="alert"');
    expect(confirmation).toContain(
      "getListingRequestIntent(client, intentId.data).catch",
    );
    expect(submit).toContain("useFormStatus");
    expect(submit).toContain("disabled={pending}");
  });

  it("keeps the market shell as the only main landmark and distinguishes outages from missing records", () => {
    const pages = [
      "app/[market]/listings/[listing]/request/page.tsx",
      "app/[market]/requests/page.tsx",
      "app/[market]/requests/[request]/page.tsx",
    ].map(read);
    for (const page of pages) expect(page).not.toContain("<main");

    const detail = pages[2];
    expect(detail.indexOf("if (result.error)")).toBeLessThan(
      detail.indexOf("notFound();", detail.indexOf("const result")),
    );
    expect(detail).toContain('role="alert"');
    expect(detail).toContain("Request temporarily unavailable");
  });
});
