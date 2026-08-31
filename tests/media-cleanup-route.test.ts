import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getAdminClient: vi.fn(),
  runCleanup: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getServerAdminSupabaseClient: mocks.getAdminClient,
}));
vi.mock("@/lib/media/orphan-cleanup", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/media/orphan-cleanup")>();
  return { ...original, runOrphanMediaCleanup: mocks.runCleanup };
});

import { POST } from "@/app/api/internal/media/cleanup/route";

const cleanupSecret = "cleanup-secret-0123456789-abcdefghij";
const adminClient = { role: "service" };

function cleanupRequest(options?: {
  authorization?: string;
  body?: string;
  contentType?: string;
}) {
  const headers: Record<string, string> = {};
  if (options?.authorization) {
    headers.authorization = options.authorization;
  }
  if (options?.contentType) headers["content-type"] = options.contentType;

  return new Request("https://localhub.example/api/internal/media/cleanup", {
    method: "POST",
    headers,
    body: options?.body,
  });
}

function chunkedOversizedCleanupRequest() {
  const encoder = new TextEncoder();
  let pulls = 0;
  let cancelled = false;
  const request = new Request(
    "https://localhub.example/api/internal/media/cleanup",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${cleanupSecret}`,
        "content-type": "application/json",
      },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(encoder.encode("x".repeat(256)));
        },
        cancel() {
          cancelled = true;
        },
      }),
      duplex: "half",
    } as RequestInit,
  );
  return { cancelled: () => cancelled, pulls: () => pulls, request };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MEDIA_CLEANUP_SECRET", cleanupSecret);
  mocks.getAdminClient.mockReturnValue(adminClient);
  mocks.runCleanup.mockResolvedValue({
    ok: true,
    counts: { claimed: 0, completed: 0, failed: 0 },
  });
});

describe("protected media cleanup route", () => {
  it("fails before constructing the admin client for absent or wrong credentials", async () => {
    const absent = await POST(cleanupRequest());
    const wrong = await POST(
      cleanupRequest({ authorization: `Bearer ${"z".repeat(40)}` }),
    );

    expect(absent.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(mocks.getAdminClient).not.toHaveBeenCalled();
    expect(mocks.runCleanup).not.toHaveBeenCalled();
  });

  it("fails closed when the dedicated secret or provider is unavailable", async () => {
    vi.stubEnv("MEDIA_CLEANUP_SECRET", "short");
    const missingSecret = await POST(cleanupRequest());
    expect(missingSecret.status).toBe(503);
    expect(mocks.getAdminClient).not.toHaveBeenCalled();

    vi.stubEnv("MEDIA_CLEANUP_SECRET", cleanupSecret);
    mocks.getAdminClient.mockReturnValue(null);
    const missingProvider = await POST(
      cleanupRequest({ authorization: `Bearer ${cleanupSecret}` }),
    );
    expect(missingProvider.status).toBe(503);
    expect(mocks.runCleanup).not.toHaveBeenCalled();
  });

  it("uses the bounded default and rejects invalid batches before admin access", async () => {
    const accepted = await POST(
      cleanupRequest({ authorization: `Bearer ${cleanupSecret}` }),
    );
    expect(accepted.status).toBe(200);
    expect(mocks.runCleanup).toHaveBeenCalledWith(adminClient, 25);

    vi.clearAllMocks();
    mocks.getAdminClient.mockReturnValue(adminClient);
    const invalid = await POST(
      cleanupRequest({
        authorization: `Bearer ${cleanupSecret}`,
        contentType: "application/json",
        body: JSON.stringify({ batchSize: 101 }),
      }),
    );
    expect(invalid.status).toBe(400);
    expect(mocks.getAdminClient).not.toHaveBeenCalled();
    expect(mocks.runCleanup).not.toHaveBeenCalled();
  });

  it("cancels oversized chunked bodies before creating the admin client", async () => {
    const stream = chunkedOversizedCleanupRequest();

    const response = await POST(stream.request);

    expect(response.status).toBe(400);
    expect(stream.cancelled()).toBe(true);
    expect(stream.pulls()).toBeLessThan(16);
    expect(mocks.getAdminClient).not.toHaveBeenCalled();
    expect(mocks.runCleanup).not.toHaveBeenCalled();
  });

  it("returns aggregate-only partial results without leaking secrets or paths", async () => {
    const storagePath =
      "5e5e77cd-45dc-4f36-9a1f-314cad75f5db/26aa9e8f1f6c4eb2bb97e151f1c63e45.jpg";
    mocks.runCleanup.mockResolvedValue({
      ok: false,
      fatal: false,
      counts: { claimed: 3, completed: 2, failed: 1 },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await POST(
      cleanupRequest({
        authorization: `Bearer ${cleanupSecret}`,
        contentType: "application/json",
        body: JSON.stringify({ batchSize: 3 }),
      }),
    );
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(207);
    expect(JSON.parse(body)).toEqual({
      ok: false,
      claimed: 3,
      completed: 2,
      failed: 1,
    });
    expect(body).not.toContain(cleanupSecret);
    expect(body).not.toContain(storagePath);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
