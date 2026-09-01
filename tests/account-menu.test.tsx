import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountMenu } from "@/components/account-menu";
import type { AuthIdentity } from "@/lib/auth/identity";

const customer: AuthIdentity = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Ada Okafor",
  email: "ada@example.com",
  avatarUrl: "https://lh3.googleusercontent.com/a/photo",
  profileExists: true,
  accessState: "active",
  suspended: false,
  role: "customer",
  business: null,
};

describe("session-aware account menu", () => {
  it("shows only the sign-in affordance to guests and preserves context", () => {
    const html = renderToStaticMarkup(
      <AccountMenu identity={null} marketSlug="lafia" />,
    );

    expect(html).toContain("Sign in");
    expect(html).toContain("%2Flafia%2Faccount");
    expect(html).not.toContain("Sign out");
  });

  it("shows customer identity, private activity, account, and logout", () => {
    const html = renderToStaticMarkup(
      <AccountMenu identity={customer} marketSlug="lafia" />,
    );

    expect(html).toContain("Ada Okafor");
    expect(html).toContain("/lafia/account");
    expect(html).toContain("/lafia/activity");
    expect(html).toContain("/lafia/orders");
    expect(html).toContain("/lafia/requests");
    expect(html).toContain('action="/auth/logout"');
    expect(html).toContain("Sign out");
    expect(html).not.toContain("Vendor dashboard");
  });

  it("adapts accepted vendor navigation without asking for a role", () => {
    const html = renderToStaticMarkup(
      <AccountMenu
        identity={{
          ...customer,
          role: "vendor",
          business: {
            id: "22222222-2222-4222-8222-222222222222",
            name: "Amina Foods",
            memberRole: "owner",
            canManageListings: true,
          },
        }}
        marketSlug="lafia"
      />,
    );

    expect(html).toContain("Amina Foods");
    expect(html).toContain("Vendor dashboard");
    expect(html).toContain("/vendor/requests");
    expect(html).toContain("/vendor/orders");
    expect(html).toContain("/vendor/listings");
    expect(html).toContain("Business &amp; account");
    expect(html).toContain("Sign out");
  });

  it("does not offer listing management to vendor staff", () => {
    const html = renderToStaticMarkup(
      <AccountMenu
        identity={{
          ...customer,
          role: "vendor",
          business: {
            id: "22222222-2222-4222-8222-222222222222",
            name: "Amina Foods",
            memberRole: "staff",
            canManageListings: false,
          },
        }}
        marketSlug="lafia"
      />,
    );

    expect(html).not.toContain("/vendor/listings");
    expect(html).toContain("/vendor/requests");
  });

  it("keeps suspended identity visible while hiding private activity", () => {
    const html = renderToStaticMarkup(
      <AccountMenu
        identity={{
          ...customer,
          accessState: "suspended",
          suspended: true,
        }}
        marketSlug="lafia"
      />,
    );

    expect(html).toContain("Ada Okafor");
    expect(html).toContain("Restricted account");
    expect(html).toContain("/lafia/account");
    expect(html).toContain("Sign out");
    expect(html).not.toContain("/lafia/orders");
    expect(html).not.toContain("/lafia/requests");
  });

  it("does not mislabel or expose vendor tools while identity reads are unavailable", () => {
    const html = renderToStaticMarkup(
      <AccountMenu
        identity={{
          ...customer,
          accessState: "unavailable",
          role: "vendor",
          business: {
            id: "22222222-2222-4222-8222-222222222222",
            name: "Amina Foods",
            memberRole: "owner",
            canManageListings: true,
          },
        }}
        marketSlug="lafia"
      />,
    );

    expect(html).toContain("Ada Okafor");
    expect(html).toContain("Account unavailable");
    expect(html).not.toContain("Amina Foods");
    expect(html).not.toContain("Vendor dashboard");
    expect(html).not.toContain("/vendor/requests");
    expect(html).toContain("Sign out");
  });
});
