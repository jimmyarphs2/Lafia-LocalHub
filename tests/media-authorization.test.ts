import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { authorizeListingMedia } from "@/lib/media/authorization";

const listingId = "5e5e77cd-45dc-4f36-9a1f-314cad75f5db";
const businessId = "2dd03116-25d7-4f7f-9703-e9cda24d265b";
const userId = "364af025-4039-49e7-80c5-ef46e158bf79";

function mediaClient(options: {
  authenticated?: boolean;
  listing?: { id: string; business_id: string; status: string } | null;
  manager?: boolean;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data:
      options.listing === undefined
        ? { id: listingId, business_id: businessId, status: "draft" }
        : options.listing,
    error: null,
  });
  const eq = vi.fn(() => ({ eq, maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn().mockResolvedValue({
    data: options.manager ?? true,
    error: null,
  });
  const getUser = vi.fn().mockResolvedValue({
    data: { user: options.authenticated === false ? null : { id: userId } },
    error: null,
  });

  return {
    client: {
      auth: { getUser },
      from,
      rpc,
    } as unknown as SupabaseClient,
    from,
    getUser,
    rpc,
  };
}

describe("media listing authorization", () => {
  it("authorizes only a draft listing", async () => {
    const { client, from } = mediaClient({});

    await expect(authorizeListingMedia(client, listingId)).resolves.toEqual({
      ok: true,
      listing: { listingId, businessId, userId },
    });
    expect(from).toHaveBeenCalledWith("listings");
  });

  it("uses only the active-aware business-manager helper", async () => {
    const { client, rpc } = mediaClient({});

    await expect(authorizeListingMedia(client, listingId)).resolves.toEqual({
      ok: true,
      listing: { listingId, businessId, userId },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("is_business_manager", {
      target_business: businessId,
    });
    expect(rpc).not.toHaveBeenCalledWith(
      "is_active_profile",
      expect.anything(),
    );
  });

  it("fails closed before listing access when authentication is absent", async () => {
    const { client, from, rpc } = mediaClient({ authenticated: false });

    await expect(authorizeListingMedia(client, listingId)).resolves.toEqual({
      ok: false,
      reason: "authentication_required",
    });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a member who is not an active business manager", async () => {
    const { client } = mediaClient({ manager: false });

    await expect(authorizeListingMedia(client, listingId)).resolves.toEqual({
      ok: false,
      reason: "listing_access_denied",
    });
  });

  it.each(["active", "paused"])(
    "rejects a %s listing before manager authorization",
    async (status) => {
      const { client, rpc } = mediaClient({
        listing: { id: listingId, business_id: businessId, status },
      });

      await expect(authorizeListingMedia(client, listingId)).resolves.toEqual({
        ok: false,
        reason: "listing_access_denied",
      });
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("rejects a foreign or inaccessible listing", async () => {
    const { client, rpc } = mediaClient({ listing: null });

    await expect(authorizeListingMedia(client, listingId)).resolves.toEqual({
      ok: false,
      reason: "listing_access_denied",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("allows an authorized manager to clean up an active listing object", async () => {
    const { client, rpc } = mediaClient({
      listing: { id: listingId, business_id: businessId, status: "active" },
    });

    await expect(
      authorizeListingMedia(client, listingId, "cleanup"),
    ).resolves.toEqual({
      ok: true,
      listing: { listingId, businessId, userId },
    });
    expect(rpc).toHaveBeenCalledWith("is_business_manager", {
      target_business: businessId,
    });
  });
});
