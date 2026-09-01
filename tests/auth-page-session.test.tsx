import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authReturnCookie: null as string | null,
  getCurrentIdentity: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () =>
      mocks.authReturnCookie
        ? { name: "localhub-auth-return", value: mocks.authReturnCookie }
        : undefined,
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/identity", () => ({
  getCurrentIdentity: mocks.getCurrentIdentity,
}));

import AuthPage from "@/app/auth/page";
import { serializeAuthReturnCookie } from "@/lib/auth/redirects";

describe("session-aware auth page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authReturnCookie = null;
    mocks.getCurrentIdentity.mockResolvedValue({ userId: "user-1" });
  });

  it("uses the opaque continuation cookie without exposing the path in auth search params", async () => {
    mocks.authReturnCookie = serializeAuthReturnCookie(
      "/lafia/search?q=private-intent",
    );

    await expect(
      AuthPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/lafia/search?q=private-intent");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/lafia/search?q=private-intent",
    );
  });

  it("does not offer duplicate sign-in to an already authenticated user", async () => {
    await expect(
      AuthPage({
        searchParams: Promise.resolve({ next: "/lafia/account" }),
      }),
    ).rejects.toThrow("REDIRECT:/lafia/account");
    expect(mocks.redirect).toHaveBeenCalledWith("/lafia/account");
  });

  it("keeps the explicit signed-in resume checkpoint available", async () => {
    const html = renderToStaticMarkup(
      await AuthPage({
        searchParams: Promise.resolve({
          next: "/lafia",
          resume: "1",
          intent: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );

    expect(html).toContain("Resume your saved request");
    expect(html).toContain("Resume your saved work");
    expect(html).toContain("You are already signed in");
    expect(html).toContain('action="/auth/logout"');
    expect(html).not.toContain("Continue with Google");
    expect(html).not.toContain("Email me a sign-in link");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
