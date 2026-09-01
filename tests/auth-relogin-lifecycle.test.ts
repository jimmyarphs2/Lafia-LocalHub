import { beforeEach, describe, expect, it, vi } from "vitest";

type CookieOptions = {
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: "lax" | "strict" | "none" | boolean;
  secure?: boolean;
};

type ServerClientOptions = {
  cookies: {
    setAll: (
      cookies: Array<{
        name: string;
        value: string;
        options: CookieOptions;
      }>,
      headers?: Record<string, string>,
    ) => void;
  };
};

const authMocks = vi.hoisted(() => ({
  consumeAuthRateLimit: vi.fn(),
  flows: [] as Array<{ flowId: string; providerUrl: string }>,
  signOut: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({
  getAppOrigin: () => "http://localhost:3000",
  getAppUrl: () => new URL("http://localhost:3000"),
  getPublicSupabaseConfig: () => ({
    anonKey: "test-anon-key",
    url: "https://localhub.supabase.test",
  }),
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  consumeAuthRateLimit: authMocks.consumeAuthRateLimit,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getServerAdminSupabaseClient: () => ({}),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: ServerClientOptions,
  ) => ({
    auth: {
      exchangeCodeForSession: async (
        code: string,
        flow?: { flowId?: string },
      ) => {
        options.cookies.setAll([
          {
            name: "sb-localhub-auth-token",
            value: `session-${flow?.flowId ?? code}`,
            options: { httpOnly: true, path: "/", sameSite: "lax" },
          },
        ]);
        return { error: null };
      },
      getUser: async () => ({
        data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
        error: null,
      }),
      signInWithOAuth: async () => {
        const flow = authMocks.flows.shift();
        if (!flow)
          return {
            data: { flowId: null, url: null },
            error: { message: "missing test flow" },
          };
        options.cookies.setAll([
          {
            name: `sb-localhub-auth-token-flow-${flow.flowId}-code-verifier`,
            value: `verifier-${flow.flowId}`,
            options: { httpOnly: true, path: "/", sameSite: "lax" },
          },
          {
            name: "sb-localhub-auth-token-flows-code-verifier",
            value: `index-${flow.flowId}`,
            options: { httpOnly: true, path: "/", sameSite: "lax" },
          },
        ]);
        return {
          data: { flowId: flow.flowId, url: flow.providerUrl },
          error: null,
        };
      },
      signOut: authMocks.signOut,
    },
    rpc: async () => ({ data: null, error: null }),
  }),
}));

import { NextRequest, type NextResponse } from "next/server";

import { GET as authCallback } from "@/app/auth/callback/route";
import { POST as logout } from "@/app/auth/logout/route";
import { POST as startProviderAuth } from "@/app/auth/provider/route";
import { authReturnCookieName } from "@/lib/auth/redirects";

class CookieJar {
  private readonly values = new Map<string, string>();

  apply(response: NextResponse) {
    response.cookies.getAll().forEach((cookie) => {
      if (cookie.maxAge === 0 || cookie.value === "") {
        this.values.delete(cookie.name);
      } else {
        this.values.set(cookie.name, cookie.value);
      }
    });
  }

  get(name: string) {
    return this.values.get(name);
  }

  hasPrefix(prefix: string) {
    return [...this.values.keys()].some((name) => name.startsWith(prefix));
  }

  hasNameContaining(fragment: string) {
    return [...this.values.keys()].some((name) => name.includes(fragment));
  }

  header() {
    return [...this.values]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

function withCookies(jar: CookieJar) {
  const cookie = jar.header();
  return cookie ? { cookie } : undefined;
}

function providerRequest(jar: CookieJar, next = "/lafia/account") {
  return new NextRequest("http://localhost:3000/auth/provider", {
    body: new URLSearchParams({ next, provider: "google" }),
    headers: {
      ...withCookies(jar),
      "content-type": "application/x-www-form-urlencoded",
      origin: "http://localhost:3000",
    },
    method: "POST",
  });
}

function callbackRequest(jar: CookieJar, code: string, flowId: string) {
  return new NextRequest(
    `http://localhost:3000/auth/callback?code=${code}&sb_flow_id=${flowId}`,
    { headers: withCookies(jar) },
  );
}

function logoutRequest(jar: CookieJar) {
  return new NextRequest("http://localhost:3000/auth/logout", {
    body: new URLSearchParams({ next: "/" }),
    headers: {
      ...withCookies(jar),
      "content-type": "application/x-www-form-urlencoded",
      origin: "http://localhost:3000",
    },
    method: "POST",
  });
}

async function completeLogin(jar: CookieJar, flowId: string, code: string) {
  const provider = await startProviderAuth(providerRequest(jar));
  jar.apply(provider);
  expect(provider.headers.get("location")).toContain("accounts.google.test");
  expect(jar.get(authReturnCookieName(flowId))).toBeTruthy();

  const callback = await authCallback(callbackRequest(jar, code, flowId));
  jar.apply(callback);
  return callback;
}

describe("Google relogin lifecycle", () => {
  beforeEach(() => {
    authMocks.consumeAuthRateLimit.mockReset();
    authMocks.consumeAuthRateLimit.mockResolvedValue("allowed");
    authMocks.signOut.mockReset();
    authMocks.signOut.mockResolvedValue({ error: null });
    authMocks.flows = [
      {
        flowId: "flow_login_001",
        providerUrl: "https://accounts.google.test/first",
      },
      {
        flowId: "flow_login_002",
        providerUrl: "https://accounts.google.test/second",
      },
      {
        flowId: "flow_login_003",
        providerUrl: "https://accounts.google.test/fresh",
      },
    ];
  });

  it("supports login, complete local logout, and a clean second login", async () => {
    const returningBrowser = new CookieJar();
    const firstCallback = await completeLogin(
      returningBrowser,
      "flow_login_001",
      "code-one",
    );

    expect(new URL(firstCallback.headers.get("location")!).pathname).toBe(
      "/lafia/account",
    );
    expect(returningBrowser.get("sb-localhub-auth-token")).toBe(
      "session-flow_login_001",
    );

    const logoutResponse = await logout(logoutRequest(returningBrowser));
    returningBrowser.apply(logoutResponse);

    expect(authMocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(returningBrowser.hasPrefix("sb-localhub-auth-token")).toBe(false);
    expect(returningBrowser.hasPrefix("localhub-auth-return")).toBe(false);

    const secondCallback = await completeLogin(
      returningBrowser,
      "flow_login_002",
      "code-two",
    );

    expect(new URL(secondCallback.headers.get("location")!).pathname).toBe(
      "/lafia/account",
    );
    expect(returningBrowser.get("sb-localhub-auth-token")).toBe(
      "session-flow_login_002",
    );
    expect(returningBrowser.hasNameContaining("flow_login_001")).toBe(false);
  });

  it("matches the successful behavior of a fresh private-session cookie jar", async () => {
    // This models the application-observable difference of incognito: no prior
    // LocalHub session, continuation, or PKCE cookies are present.
    authMocks.flows = [
      {
        flowId: "flow_login_003",
        providerUrl: "https://accounts.google.test/fresh",
      },
    ];
    const freshBrowser = new CookieJar();
    const callback = await completeLogin(
      freshBrowser,
      "flow_login_003",
      "fresh-code",
    );

    expect(new URL(callback.headers.get("location")!).pathname).toBe(
      "/lafia/account",
    );
    expect(freshBrowser.get("sb-localhub-auth-token")).toBe(
      "session-flow_login_003",
    );
    expect(freshBrowser.hasPrefix("localhub-auth-return")).toBe(false);
  });
});
