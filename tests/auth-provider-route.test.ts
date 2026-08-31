import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  adminClient: {} as Record<string, never> | null,
  consumeAuthRateLimit: vi.fn(),
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
  createServerClient: () => ({
    auth: { signInWithOAuth: authMocks.signInWithOAuth },
  }),
}));
vi.mock("@/lib/auth/rate-limit", () => ({
  consumeAuthRateLimit: authMocks.consumeAuthRateLimit,
}));
vi.mock("@/lib/supabase/admin", () => ({
  getServerAdminSupabaseClient: () => authMocks.adminClient,
}));

import { NextRequest } from "next/server";

import { POST } from "@/app/auth/provider/route";

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
    authMocks.consumeAuthRateLimit.mockReset();
    authMocks.signInWithOAuth.mockReset();
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
