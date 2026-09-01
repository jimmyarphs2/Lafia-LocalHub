import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  config: {
    anonKey: "test-anon-key",
    url: "https://localhub.supabase.test",
  } as { anonKey: string; url: string } | null,
  adminClient: {} as Record<string, never> | null,
  consumeAuthRateLimit: vi.fn(),
  signInWithOtp: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({
  getAppOrigin: () => "http://localhost:3000",
  getAppUrl: () => new URL("http://localhost:3000"),
  getPublicSupabaseConfig: () => authMocks.config,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { signInWithOtp: authMocks.signInWithOtp },
  }),
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  consumeAuthRateLimit: authMocks.consumeAuthRateLimit,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getServerAdminSupabaseClient: () => authMocks.adminClient,
}));

import { NextRequest } from "next/server";

import { POST } from "@/app/auth/email/route";
import {
  AUTH_RETURN_COOKIE,
  authReturnStateCookieName,
} from "@/lib/auth/redirects";

function emailRequest(values: Record<string, string>) {
  return new NextRequest("http://localhost:3000/auth/email", {
    body: new URLSearchParams(values),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "http://localhost:3000",
    },
    method: "POST",
  });
}

function oversizedChunkedEmailRequest() {
  const encoder = new TextEncoder();
  let pulls = 0;
  let cancelled = false;
  const request = new NextRequest("http://localhost:3000/auth/email", {
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

describe("email authentication browser flow", () => {
  beforeEach(() => {
    authMocks.config = {
      anonKey: "test-anon-key",
      url: "https://localhub.supabase.test",
    };
    authMocks.adminClient = {};
    authMocks.consumeAuthRateLimit.mockReset();
    authMocks.consumeAuthRateLimit.mockResolvedValue("allowed");
    authMocks.signInWithOtp.mockReset();
    authMocks.signInWithOtp.mockResolvedValue({ error: null });
  });

  it("redirects successful form submissions to an allowlisted generic notice", async () => {
    const response = await POST(
      emailRequest({
        email: "merchant@example.com",
        next: "/vendor/onboarding",
      }),
    );
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/auth");
    expect(location.searchParams.has("next")).toBe(false);
    expect(location.searchParams.get("notice")).toBe("check_email");
    const emailRedirectTo = new URL(
      authMocks.signInWithOtp.mock.calls[0]?.[0].options.emailRedirectTo,
    );
    const returnState = emailRedirectTo.searchParams.get("return_state");
    const returnCookieName = authReturnStateCookieName(returnState);
    expect(returnState).toMatch(/^[0-9a-f-]{36}$/i);
    expect(returnCookieName).toBeTruthy();
    expect(response.cookies.get(returnCookieName!)?.value).toBeTruthy();
    expect(response.cookies.get(returnCookieName!)?.httpOnly).toBe(true);
    expect(response.cookies.get(returnCookieName!)?.sameSite).toBe("lax");
    expect(response.cookies.get(returnCookieName!)?.maxAge).toBe(900);
    expect(response.cookies.get(AUTH_RETURN_COOKIE)?.maxAge).toBe(0);
    expect(emailRedirectTo.pathname).toBe("/auth/callback");
    expect(emailRedirectTo.searchParams.has("next")).toBe(false);
    expect(location.href).not.toContain("merchant%40example.com");
    expect(location.href).not.toContain("merchant@example.com");
  });

  it("returns the identical generic outcome when the provider rejects the request", async () => {
    authMocks.signInWithOtp.mockResolvedValueOnce({
      error: { message: "account or rate-limit detail" },
    });

    const response = await POST(
      emailRequest({
        email: "unknown@example.com",
        next: "/vendor/onboarding",
      }),
    );
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(303);
    expect(location.searchParams.get("notice")).toBe("check_email");
    expect(location.searchParams.has("error")).toBe(false);
    expect(location.href).not.toContain("unknown");
  });

  it("sanitizes the return path and redirects invalid email input without echoing it", async () => {
    const response = await POST(
      emailRequest({
        email: "not-an-email",
        next: "https://attacker.example/collect",
      }),
    );
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/auth");
    expect(location.searchParams.has("next")).toBe(false);
    expect(location.searchParams.get("error")).toBe("auth_failed");
    expect(location.href).not.toContain("not-an-email");
    expect(authMocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it("uses the allowlisted configuration error when the provider is not configured", async () => {
    authMocks.config = null;

    const response = await POST(
      emailRequest({ email: "merchant@example.com", next: "/lafia" }),
    );
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(303);
    expect(location.searchParams.get("error")).toBe("configuration");
    expect(location.searchParams.has("notice")).toBe(false);
  });

  it("cancels an oversized chunked form before rate-limit or provider operations", async () => {
    const stream = oversizedChunkedEmailRequest();

    const response = await POST(stream.request);
    const location = new URL(response.headers.get("location")!);

    expect(location.searchParams.get("error")).toBe("auth_failed");
    expect(stream.cancelled()).toBe(true);
    expect(stream.pulls()).toBeLessThan(16);
    expect(authMocks.consumeAuthRateLimit).not.toHaveBeenCalled();
    expect(authMocks.signInWithOtp).not.toHaveBeenCalled();
  });
});
