import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentIdentity: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("@/lib/auth/identity", () => ({
  getCurrentIdentity: mocks.getCurrentIdentity,
}));

import AccountPage from "@/app/[market]/account/page";

const customer = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Ada Okafor",
  email: "ada@example.com",
  avatarUrl: null,
  profileExists: true,
  accessState: "active" as const,
  suspended: false,
  role: "customer" as const,
  business: null,
};

describe("account profile page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves the exact account destination for a guest", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(null);
    await expect(
      AccountPage({ params: Promise.resolve({ market: "lafia" }) }),
    ).rejects.toThrow("REDIRECT:/auth?next=%2Flafia%2Faccount");
  });

  it("shows verified customer identity and private destinations", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(customer);
    const html = renderToStaticMarkup(
      await AccountPage({ params: Promise.resolve({ market: "lafia" }) }),
    );

    expect(html).toContain("Welcome, Ada Okafor");
    expect(html).toContain("ada@example.com");
    expect(html).toContain("/lafia/activity");
    expect(html).toContain("/lafia/orders");
    expect(html).toContain("/vendor/onboarding");
    expect(html).toContain('action="/auth/logout"');
    expect(html).toContain("Sign out of LocalHub");
  });

  it("shows an accepted business without repeating onboarding", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({
      ...customer,
      role: "vendor",
      business: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Amina Foods",
        memberRole: "owner",
        canManageListings: true,
      },
    });
    const html = renderToStaticMarkup(
      await AccountPage({ params: Promise.resolve({ market: "lafia" }) }),
    );

    expect(html).toContain("Amina Foods");
    expect(html).toContain("/vendor");
    expect(html).not.toContain("Begin vendor onboarding");
  });

  it("keeps sign-in identity visible but hides private actions when suspended", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({
      ...customer,
      accessState: "suspended",
      suspended: true,
    });
    const html = renderToStaticMarkup(
      await AccountPage({ params: Promise.resolve({ market: "lafia" }) }),
    );

    expect(html).toContain("Welcome, Ada Okafor");
    expect(html).toContain("currently restricted");
    expect(html).not.toContain("/lafia/orders");
    expect(html).not.toContain("/vendor/onboarding");
  });
});
