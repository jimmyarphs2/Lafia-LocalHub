import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentIdentity: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/identity", () => ({
  getCurrentIdentity: mocks.getCurrentIdentity,
}));
vi.mock("@/components/account-menu", () => ({
  AccountMenu: () => <span>Account identity</span>,
}));

import VendorLayout from "@/app/vendor/layout";

const baseIdentity = {
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

async function render() {
  return renderToStaticMarkup(
    await VendorLayout({
      children: <p>Workspace content</p>,
      params: Promise.resolve({}),
    }),
  );
}

describe("vendor layout identity navigation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not expose vendor tool navigation to guests", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(null);
    const html = await render();
    expect(html).not.toContain("Business setup");
    expect(html).not.toContain("Request inbox");
  });

  it("offers only intentional onboarding to an active customer", async () => {
    mocks.getCurrentIdentity.mockResolvedValue(baseIdentity);
    const html = await render();
    expect(html).toContain("Business setup");
    expect(html).not.toContain("Listing drafts");
    expect(html).not.toContain("Request inbox");
  });

  it("shows staff request and order tools without listing management", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({
      ...baseIdentity,
      role: "vendor",
      business: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Amina Foods",
        memberRole: "staff",
        canManageListings: false,
      },
    });
    const html = await render();
    expect(html).toContain("Request inbox");
    expect(html).toContain("Order inbox");
    expect(html).not.toContain("Listing drafts");
    expect(html).not.toContain("Media lab");
  });

  it("fails closed for suspended identities", async () => {
    mocks.getCurrentIdentity.mockResolvedValue({
      ...baseIdentity,
      accessState: "suspended",
      suspended: true,
    });
    const html = await render();
    expect(html).not.toContain("Business setup");
    expect(html).not.toContain("Request inbox");
  });
});
