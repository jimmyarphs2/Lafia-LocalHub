import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runOrphanMediaCleanup } from "@/lib/media/orphan-cleanup";

const firstCandidate = {
  storage_path:
    "5e5e77cd-45dc-4f36-9a1f-314cad75f5db/26aa9e8f1f6c4eb2bb97e151f1c63e45.jpg",
  cleanup_claim_token: "37f91372-2269-4b05-8db5-58e4dca17783",
};
const secondCandidate = {
  storage_path:
    "8a2db4a4-cd38-43f0-8770-4f231bfae2a5/8fcd487a63354ebc8bc009531194a86e.png",
  cleanup_claim_token: "f11c6bfa-c95a-489d-8ab5-b5adaf15fa45",
};

const mocks = {
  remove: vi.fn(),
  rpc: vi.fn(),
  storageFrom: vi.fn(),
};

const client = {
  rpc: mocks.rpc,
  storage: { from: mocks.storageFrom },
} as unknown as SupabaseClient;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storageFrom.mockReturnValue({ remove: mocks.remove });
  mocks.remove.mockResolvedValue({ data: [], error: null });
});

describe("orphan listing-media cleanup runner", () => {
  it("claims before exact removal and completes only after Storage succeeds", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [firstCandidate], error: null })
      .mockResolvedValueOnce({ data: true, error: null });

    await expect(runOrphanMediaCleanup(client, 25)).resolves.toEqual({
      ok: true,
      counts: { claimed: 1, completed: 1, failed: 0 },
    });

    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      "claim_orphan_listing_media_cleanup",
      { p_batch_size: 25 },
    );
    expect(mocks.storageFrom).toHaveBeenCalledWith("listing-media");
    expect(mocks.remove).toHaveBeenCalledWith([firstCandidate.storage_path]);
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      2,
      "complete_orphan_listing_media_cleanup",
      {
        p_storage_path: firstCandidate.storage_path,
        p_cleanup_claim_token: firstCandidate.cleanup_claim_token,
      },
    );
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.remove.mock.invocationCallOrder[0],
    );
    expect(mocks.remove.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[1],
    );
  });

  it("handles partial Storage failure and records only a generic error code", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_orphan_listing_media_cleanup") {
        return { data: [firstCandidate, secondCandidate], error: null };
      }
      return { data: true, error: null };
    });
    mocks.remove
      .mockResolvedValueOnce({
        data: null,
        error: new Error("raw secret path"),
      })
      .mockResolvedValueOnce({ data: [], error: null });

    await expect(runOrphanMediaCleanup(client, 2)).resolves.toEqual({
      ok: false,
      fatal: false,
      counts: { claimed: 2, completed: 1, failed: 1 },
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "fail_orphan_listing_media_cleanup",
      {
        p_storage_path: firstCandidate.storage_path,
        p_cleanup_claim_token: firstCandidate.cleanup_claim_token,
        p_error: "STORAGE_REMOVE_FAILED",
      },
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_orphan_listing_media_cleanup",
      {
        p_storage_path: secondCandidate.storage_path,
        p_cleanup_claim_token: secondCandidate.cleanup_claim_token,
      },
    );
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(
      "raw secret path",
    );
  });

  it("never sends a non-canonical claimed path to Storage", async () => {
    const invalidCandidate = {
      ...firstCandidate,
      storage_path: "../private-verification/identity.jpg",
    };
    mocks.rpc
      .mockResolvedValueOnce({ data: [invalidCandidate], error: null })
      .mockResolvedValueOnce({ data: true, error: null });

    await expect(runOrphanMediaCleanup(client, 25)).resolves.toEqual({
      ok: false,
      fatal: false,
      counts: { claimed: 1, completed: 0, failed: 1 },
    });

    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "complete_orphan_listing_media_cleanup",
      expect.anything(),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fail_orphan_listing_media_cleanup",
      {
        p_storage_path: invalidCandidate.storage_path,
        p_cleanup_claim_token: invalidCandidate.cleanup_claim_token,
        p_error: "INVALID_CANDIDATE",
      },
    );
  });

  it("marks a completion failure retryable after the exact removal", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [firstCandidate], error: null })
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: true, error: null });

    await expect(runOrphanMediaCleanup(client, 25)).resolves.toMatchObject({
      ok: false,
      fatal: false,
      counts: { claimed: 1, completed: 0, failed: 1 },
    });

    expect(mocks.remove.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[1],
    );
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      3,
      "fail_orphan_listing_media_cleanup",
      {
        p_storage_path: firstCandidate.storage_path,
        p_cleanup_claim_token: firstCandidate.cleanup_claim_token,
        p_error: "CLEANUP_COMPLETE_FAILED",
      },
    );
  });

  it("fails closed when the claim RPC is unavailable or malformed", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("db") });
    await expect(runOrphanMediaCleanup(client, 25)).resolves.toEqual({
      ok: false,
      fatal: true,
      counts: { claimed: 0, completed: 0, failed: 0 },
    });
    expect(mocks.remove).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.storageFrom.mockReturnValue({ remove: mocks.remove });
    mocks.rpc.mockResolvedValueOnce({
      data: { path: "not-an-array" },
      error: null,
    });
    await expect(runOrphanMediaCleanup(client, 25)).resolves.toMatchObject({
      ok: false,
      fatal: true,
    });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
