import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  config: {
    anonKey: "test-anon-key",
    url: "https://localhub.supabase.test",
  } as { anonKey: string; url: string } | null,
  signOut: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({
  getAppOrigin: () => "http://localhost:3000",
  getAppUrl: () => new URL("http://localhost:3000"),
  getPublicSupabaseConfig: () => authMocks.config,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { signOut: authMocks.signOut },
  }),
}));

import { NextRequest } from "next/server";

import * as logoutRoute from "@/app/auth/logout/route";

function logoutRequest(next = "/lafia", origin = "http://localhost:3000") {
  return new NextRequest("http://localhost:3000/auth/logout", {
    body: new URLSearchParams({ next }),
    headers: {
      cookie:
        "sb-localhub-auth-token=expired; sb-localhub-auth-token.0=chunk; localhub-auth-return-flow_google_123=continuation; unrelated=keep",
      "content-type": "application/x-www-form-urlencoded",
      origin,
    },
    method: "POST",
  });
}

describe("local session logout", () => {
  beforeEach(() => {
    authMocks.config = {
      anonKey: "test-anon-key",
      url: "https://localhub.supabase.test",
    };
    authMocks.signOut.mockReset();
    authMocks.signOut.mockResolvedValue({ error: null });
  });

  it("is POST-only, signs out the local session, and expires all project auth chunks", async () => {
    expect("GET" in logoutRoute).toBe(false);

    const response = await logoutRoute.POST(logoutRequest());

    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/lafia");
    expect(authMocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.cookies.get("sb-localhub-auth-token")?.value).toBe("");
    expect(response.cookies.get("sb-localhub-auth-token")?.maxAge).toBe(0);
    expect(response.cookies.get("sb-localhub-auth-token.0")?.maxAge).toBe(0);
    expect(
      response.cookies.get("localhub-auth-return-flow_google_123")?.maxAge,
    ).toBe(0);
    expect(response.cookies.get("unrelated")).toBeUndefined();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("clears expired local cookies even if the provider rejects logout", async () => {
    authMocks.signOut.mockRejectedValueOnce(new Error("session missing"));

    const response = await logoutRoute.POST(
      logoutRequest("https://attacker.example/collect"),
    );

    expect(new URL(response.headers.get("location")!).pathname).toBe("/");
    expect(response.cookies.get("sb-localhub-auth-token")?.maxAge).toBe(0);
    expect(response.cookies.get("sb-localhub-auth-token.0")?.maxAge).toBe(0);
  });

  it("rejects cross-origin requests before touching the session", async () => {
    const response = await logoutRoute.POST(
      logoutRequest("/", "https://attacker.example"),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Invalid request origin." });
    expect(authMocks.signOut).not.toHaveBeenCalled();
  });
});
