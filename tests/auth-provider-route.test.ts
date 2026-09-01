import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  adminClient: {} as Record<string, never> | null,
  consumeAuthRateLimit: vi.fn(),
  clientOptions: null as null | {
    auth?: { experimental?: { appendPkceFlowIdToRedirects?: boolean } };
    cookieOptions?: { httpOnly?: boolean; sameSite?: string };
    cookies: {
      setAll: (
        cookies: Array<{
          name: string;
          value: string;
          options: { httpOnly?: boolean; path?: string; sameSite?: string };
        }>,
        headers: Record<string, string>,
      ) => void;
    };
  },
  signInWithOAuth: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({
  getAppOrigin: () => "http://localhost:3000",
  getAppUrl: () => new URL("http://localhost:3000"),
  getPublicSupabaseConfig: () => ({
    anonKey: "test-anon-key",
    url: "https://localhub.supabase.test",
  }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: NonNullable<typeof authMocks.clientOptions>,
  ) => {
    authMocks.clientOptions = options;
    return {
      auth: { signInWithOAuth: authMocks.signInWithOAuth },
    };
  },
}));
vi.mock("@/lib/auth/rate-limit", () => ({
  consumeAuthRateLimit: authMocks.consumeAuthRateLimit,
}));
vi.mock("@/lib/supabase/admin", () => ({
  getServerAdminSupabaseClient: () => authMocks.adminClient,
}));

import { NextRequest } from "next/server";

import { POST } from "@/app/auth/provider/route";
import { AUTH_RETURN_COOKIE, authReturnCookieName } from "@/lib/auth/redirects";

function providerRequest(values: Record<string, string>) {
  return new NextRequest("http://localhost:3000/auth/provider", {
    body: new URLSearchParams(values),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "http://localhost:3000",
    },
    method: "POST",
  });
}

function oversizedChunkedProviderRequest() {
  const encoder = new TextEncoder();
  let pulls = 0;
  let cancelled = false;
  const request = new NextRequest("http://localhost:3000/auth/provider", {
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(encoder.encode("x".repeat(512)));
      },
      cancel() {
        cancelled = true;
      },
    }),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "http://localhost:3000",
    },
    method: "POST",
    duplex: "half",
  } as never);
  return { cancelled: () => cancelled, pulls: () => pulls, request };
}

describe("provider authentication body boundary", () => {
  beforeEach(() => {
    authMocks.adminClient = {};
    authMocks.clientOptions = null;
    authMocks.consumeAuthRateLimit.mockReset();
    authMocks.consumeAuthRateLimit.mockResolvedValue("allowed");
    authMocks.signInWithOAuth.mockReset();
    authMocks.signInWithOAuth.mockResolvedValue({
      data: {
        flowId: "flow_google_123",
        url: "https://accounts.google.test/oauth",
      },
      error: null,
    });
  });

  it("keeps the exact return path in an HttpOnly cookie, not the OAuth callback URL", async () => {
    authMocks.signInWithOAuth.mockImplementationOnce(async () => {
      authMocks.clientOptions?.cookies.setAll(
        [
          {
            name: "sb-localhub-auth-token-flow-flow_123-code-verifier",
            value: "opaque-pkce-verifier",
            options: { httpOnly: true, path: "/", sameSite: "lax" },
          },
        ],
        {
          "Cache-Control":
            "private, no-cache, no-store, must-revalidate, max-age=0",
          Expires: "0",
          Pragma: "no-cache",
        },
      );
      return {
        data: {
          flowId: "flow_google_123",
          url: "https://accounts.google.test/oauth",
        },
        error: null,
      };
    });
    const response = await POST(
      providerRequest({
        provider: "google",
        next: "/lafia/search?q=fresh%20rice&category=groceries",
      }),
    );
    const oauthCall = authMocks.signInWithOAuth.mock.calls[0]?.[0];
    const redirectTo = new URL(oauthCall.options.redirectTo);
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://accounts.google.test/oauth",
    );
    expect(redirectTo.pathname).toBe("/auth/callback");
    expect(redirectTo.search).toBe("");
    expect(
      authMocks.clientOptions?.auth?.experimental?.appendPkceFlowIdToRedirects,
    ).toBe(true);
    expect(authMocks.clientOptions?.cookieOptions?.httpOnly).toBe(true);
    expect(authMocks.clientOptions?.cookieOptions?.sameSite).toBe("lax");
    expect(
      response.cookies.get("sb-localhub-auth-token-flow-flow_123-code-verifier")
        ?.value,
    ).toBe("opaque-pkce-verifier");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(setCookie).toContain(`${AUTH_RETURN_COOKIE}=`);
    expect(
      response.cookies.get(authReturnCookieName("flow_google_123"))?.value,
    ).toBeTruthy();
    expect(response.cookies.get(AUTH_RETURN_COOKIE)?.maxAge).toBe(0);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/Max-Age=900/i);
    expect(setCookie).not.toContain("fresh");
    expect(setCookie).not.toContain("rice");
  });

  it("clears the return cookie when OAuth initialization fails", async () => {
    authMocks.signInWithOAuth.mockResolvedValueOnce({
      data: { url: null },
      error: { message: "provider unavailable" },
    });

    const response = await POST(
      providerRequest({ provider: "google", next: "/lafia/account" }),
    );

    expect(
      new URL(response.headers.get("location")!).searchParams.get("error"),
    ).toBe("auth_failed");
    expect(response.cookies.get(AUTH_RETURN_COOKIE)?.value).toBe("");
    expect(response.cookies.get(AUTH_RETURN_COOKIE)?.maxAge).toBe(0);
  });

  it("cancels an oversized chunked form before OAuth or rate-limit operations", async () => {
    const stream = oversizedChunkedProviderRequest();

    const response = await POST(stream.request);
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(303);
    expect(location.searchParams.get("error")).toBe("auth_failed");
    expect(stream.cancelled()).toBe(true);
    expect(stream.pulls()).toBeLessThan(16);
    expect(authMocks.consumeAuthRateLimit).not.toHaveBeenCalled();
    expect(authMocks.signInWithOAuth).not.toHaveBeenCalled();
  });
});
