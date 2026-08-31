import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BusinessTriageQueue } from "@/components/admin/business-triage-queue";
import type { PendingBusinessTriageItem } from "@/lib/admin/business-triage-contract";

const business: PendingBusinessTriageItem = {
  businessId: "11111111-1111-4111-8111-111111111111",
  businessName: "Amina's Fresh Produce",
  marketId: "22222222-2222-4222-8222-222222222222",
  marketSlug: "lafia",
  marketName: "Lafia",
  categorySlug: "food-catering",
  submittedAt: "2026-08-30T10:00:00.000Z",
};

describe("admin business triage markup", () => {
  it("renders an accessible read-only triage table with a semantic submission time", () => {
    const markup = renderToStaticMarkup(
      <BusinessTriageQueue businesses={[business]} nextHref={null} />,
    );

    expect(markup).toContain("<table");
    expect(markup).toContain('aria-label="Pending business submissions table"');
    expect(markup).toContain('role="region"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toMatch(
      /<caption[^>]*>[^<]*Oldest pending business submissions/i,
    );
    expect(markup).toContain("<th");
    expect(markup).toContain("Amina&#x27;s Fresh Produce");
    expect(markup).toContain("Lafia");
    expect(markup).toContain("Food and catering");
    expect(markup).toContain('<time dateTime="2026-08-30T10:00:00.000Z">');
    expect(markup).not.toMatch(/<form\b|<button\b/i);
    expect(markup).not.toMatch(
      /approve|reject|suspend|transition|change status/i,
    );
  });

  it("does not render poisoned PII-like fields even when an untyped caller supplies them", () => {
    const poisoned = {
      ...business,
      addressText: "1 Private Street",
      legalName: "Amina Bello Legal Entity",
      metadata: { email: "private@example.test" },
      phoneE164: "+2348000000000",
      profileName: "Private owner",
    } as PendingBusinessTriageItem;
    const markup = renderToStaticMarkup(
      <BusinessTriageQueue businesses={[poisoned]} nextHref={null} />,
    );

    expect(markup).not.toContain("1 Private Street");
    expect(markup).not.toContain("Amina Bello Legal Entity");
    expect(markup).not.toContain("private@example.test");
    expect(markup).not.toContain("+2348000000000");
    expect(markup).not.toContain("Private owner");
  });

  it("uses an honest empty state without an action surface", () => {
    const empty = renderToStaticMarkup(
      <BusinessTriageQueue businesses={[]} nextHref={null} />,
    );

    expect(empty).toMatch(/no pending merchant submissions were returned/i);
    expect(empty).not.toMatch(/temporarily unavailable/i);
    expect(empty).not.toMatch(/<form\b|<button\b/i);
  });

  it("renders only supplied visible rows and a labelled, validated next-page link", () => {
    const twentySix = Array.from({ length: 26 }, (_, index) => ({
      ...business,
      businessId: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
      businessName: `Pending business ${index + 1}`,
    }));
    const markup = renderToStaticMarkup(
      <BusinessTriageQueue
        businesses={twentySix.slice(0, 25)}
        nextHref={`/admin/business-reviews?market=lafia&afterMarketId=${business.marketId}&afterSubmittedAt=${encodeURIComponent(
          business.submittedAt,
        )}&afterBusinessId=${twentySix[24]!.businessId}`}
      />,
    );

    expect(markup).toContain("Pending business 25");
    expect(markup).not.toContain("Pending business 26");
    expect(markup).toMatch(
      /href="\/admin\/business-reviews\?market=lafia&amp;afterMarketId=22222222-2222-4222-8222-222222222222&amp;afterSubmittedAt=/,
    );
    expect(markup).toMatch(
      /afterBusinessId=11111111-1111-4111-8111-000000000024/,
    );
    expect(markup).toMatch(/aria-label="Business triage pagination"/);
  });
});
