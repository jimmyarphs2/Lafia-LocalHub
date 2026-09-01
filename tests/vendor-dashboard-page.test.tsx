import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "@/lib/auth/identity";

const mocks = vi.hoisted(() => ({
  getCurrentIdentity: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/auth/identity", () => ({
  getCurrentIdentity: mocks.getCurrentIdentity,
}));

import VendorDashboardPage from "@/app/vendor/page";

const redirectSignal = new Error("NEXT_REDIRECT");

const customer: AuthIdentity = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Ada Okafor",
  email: "ada@example.com",
  avatarUrl: null,
  profileExists: true,
  accessState: "active" as const,
  suspended: false,
  role: "customer",
  business: null,
};

function vendor(memberRole: "owner" | "manager" | "staff"): AuthIdentity {
  return {
    ...customer,
    role: "vendor",
    business: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Amina Foods",
      memberRole,
      canManageListings: memberRole !== "staff",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => {
    throw redirectSignal;
  });
});

describe("vendor dashboard landing page", () => {
  it("sends a guest through authentication with the exact vendor destination", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(null);

    await expect(VendorDashboardPage()).rejects.toBe(redirectSignal);

    expect(mocks.redirect).toHaveBeenCalledWith("/auth?next=%2Fvendor");
  });

  it("offers an authenticated customer vendor onboarding without changing their role", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(customer);

    const html = renderToStaticMarkup(await VendorDashboardPage());

    expect(html).toContain("Ada Okafor");
    expect(html).toContain("Start vendor setup");
    expect(html).toContain('href="/vendor/onboarding"');
    expect(html).toContain("customer account stays active");
    expect(html).not.toContain("Amina Foods");
    expect(html).not.toContain('href="/vendor/requests"');
  });

  it("shows accepted vendor identity and the complete management workspace", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(vendor("manager"));

    const html = renderToStaticMarkup(await VendorDashboardPage());

    expect(html).toContain("Amina Foods");
    expect(html).toContain("Ada Okafor");
    expect(html).toContain("accepted manager access");
    expect(html).toContain('href="/vendor/requests"');
    expect(html).toContain('href="/vendor/orders"');
    expect(html).toContain('href="/vendor/listings"');
    expect(html).toContain('href="/vendor/media-lab"');
  });

  it("keeps staff access to operational inboxes without listing or media management", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(vendor("staff"));

    const html = renderToStaticMarkup(await VendorDashboardPage());

    expect(html).toContain('href="/vendor/requests"');
    expect(html).toContain('href="/vendor/orders"');
    expect(html).not.toContain('href="/vendor/listings"');
    expect(html).not.toContain('href="/vendor/media-lab"');
  });

  it("fails closed for suspended or internally inconsistent vendor identities", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({
      ...vendor("owner"),
      accessState: "suspended",
      suspended: true,
    });

    const suspendedHtml = renderToStaticMarkup(await VendorDashboardPage());
    expect(suspendedHtml).toContain("Vendor access is unavailable");
    expect(suspendedHtml).not.toContain('href="/vendor/requests"');
    expect(suspendedHtml).not.toContain('href="/vendor/onboarding"');

    mocks.getCurrentIdentity.mockResolvedValue({
      ...customer,
      role: "vendor",
    });

    const inconsistentHtml = renderToStaticMarkup(await VendorDashboardPage());
    expect(inconsistentHtml).toContain("Vendor workspace is unavailable");
    expect(inconsistentHtml).not.toContain('href="/vendor/orders"');
    expect(inconsistentHtml).not.toContain('href="/vendor/onboarding"');
  });
});
