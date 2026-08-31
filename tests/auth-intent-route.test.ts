import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  adminClient: { rpc: vi.fn() } as { rpc: ReturnType<typeof vi.fn> } | null,
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
  getAuthRateLimitIdentifier: () => "test-rate-limit-key",
}));
vi.mock("@/lib/supabase/admin", () => ({
  getServerAdminSupabaseClient: () => authMocks.adminClient,
}));

import { NextRequest } from "next/server";

import { POST } from "@/app/auth/intent/route";

function oversizedChunkedIntentRequest() {
  const encoder = new TextEncoder();
  let pulls = 0;
  let cancelled = false;
  const request = new NextRequest("http://localhost:3000/auth/intent", {
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(encoder.encode("x".repeat(1024)));
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

describe("guest intent body boundary", () => {
  beforeEach(() => {
    authMocks.adminClient = { rpc: vi.fn() };
  });

  it("cancels an oversized chunked form before creating an intent", async () => {
    const stream = oversizedChunkedIntentRequest();

    const response = await POST(stream.request);

    expect(response.status).toBe(400);
    expect(stream.cancelled()).toBe(true);
    expect(stream.pulls()).toBeLessThan(40);
    expect(authMocks.adminClient?.rpc).not.toHaveBeenCalled();
  });
});
