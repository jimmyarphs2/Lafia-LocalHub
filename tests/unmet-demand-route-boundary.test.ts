import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("unmet-demand route boundary", () => {
  it("replaces the misleading generic guest intent with a query-free candidate", () => {
    const source = [
      read("app/[market]/search/page.tsx"),
      read("components/search-results-experience.tsx"),
    ].join("\n");

    expect(source).toContain("deriveUnmetDemandCaptureCandidate");
    expect(source).toContain("demandConfirmationPath");
    expect(source).toContain('referrerPolicy="no-referrer"');
    expect(source).toContain('rel="noreferrer"');
    expect(source).not.toMatch(/<Link[^>]+href=\{demandPath\}/);
    expect(source).not.toContain('label="Save this unmet need"');
    expect(source).not.toMatch(
      /GuestIntentForm[\s\S]{0,1200}(unmatchedDemand|unmet_demand)/,
    );
    expect(source).not.toContain("Category gap recorded");
    expect(source).not.toContain('query.demand === "recorded"');
  });

  it("isolates demand auth from every pre-existing guest-intent outcome", () => {
    const authPage = read("app/auth/page.tsx");
    const callback = read("app/auth/callback/route.ts");
    const resume = read("app/auth/resume/route.ts");

    expect(authPage).toContain("parseDemandConfirmationPath(next)");
    expect(authPage).toContain('params.resume === "1" && !continuesDemand');
    expect(authPage).toContain("Nothing has been recorded yet.");
    expect(callback).toMatch(
      /parseDemandConfirmationPath\(next\)[\s\S]{0,160}\? null[\s\S]{0,160}: parseGuestIntentCookie/,
    );
    expect(resume).toMatch(
      /if \(parseDemandConfirmationPath\(recoveryNext\)\)[\s\S]{0,500}return response/,
    );
  });

  it("keeps confirmation GET read-only and redirects guests with no raw query", () => {
    const source = read("app/[market]/demand/confirm/page.tsx");

    expect(source).toContain("getCatalogForMarket");
    expect(source).toContain("getServerSupabaseClient");
    expect(source).toContain("demandConfirmationPath");
    expect(source).toContain("encodeURIComponent(confirmationPath)");
    expect(source).not.toMatch(/\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
    expect(source).not.toMatch(
      /searchParams\s*[.\[]\s*["']?q|name=["'](?:q|payload|guest_intent|return_to)["']/i,
    );
  });

  it("treats the Server Action as an untrusted POST and calls one typed RPC wrapper", () => {
    const source = read("app/[market]/demand/confirm/actions.ts");

    expect(source).toContain('"use server"');
    expect(source).toContain("marketSlugSchema.safeParse");
    expect(source).toContain("demandCategoryIdSchema.safeParse");
    expect(source).toContain("getServerSupabaseClient");
    expect(source).toContain("client.auth.getUser");
    expect(source).toContain("recordMyUnmetDemandZeroResult");
    expect(source).not.toMatch(/getServerAdminSupabaseClient|service_role/);
    expect(source).not.toContain("?demand=recorded");
    expect(source).not.toMatch(
      /\b(raw|query|payload|guest_intent|return_to)\b/i,
    );
  });

  it("uses the authenticated RPC with exactly the market slug and category UUID", () => {
    const source = read("lib/demand/rpc.ts");

    expect(source).toContain('client.rpc("record_my_unmet_demand_zero_result"');
    expect(source).toContain("p_market_slug: input.marketSlug");
    expect(source).toContain("p_category_id: input.categoryId");
    expect(source).not.toMatch(
      /\b(query|payload|profile|user|intent|referr|mission|reward|payment|ai)\b/i,
    );
  });
});
