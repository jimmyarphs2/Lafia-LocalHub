import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAdaptiveListingSchema } from "@/lib/ale/registry";

const ids = {
  business: "2dd03116-25d7-4f36-9a1f-314cad75f5db",
  listing: "5e5e77cd-45dc-4f36-9a1f-314cad75f5db",
  schema: "8a3a1f73-3ed5-45a0-a86e-c1cef1f842d7",
  type: "11ab2117-4da5-4b59-ae5b-4ed12ddf7b1a",
  category: "10ab2117-4da5-4b59-ae5b-4ed12ddf7b1a",
  token: "26aa9e8f-1f6c-4eb2-bb97-e151f1c63e45",
};

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  loadWorkspace: vi.fn(),
  saveDraft: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: mocks.getClient,
}));
vi.mock("@/lib/listings/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/listings/workspace")>()),
  loadVendorListingDraftWorkspace: mocks.loadWorkspace,
}));
vi.mock("@/lib/listings/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/listings/persistence")>()),
  saveListingDraft: mocks.saveDraft,
}));

import { saveVendorListingDraft } from "@/app/vendor/listings/actions";

const schema = getAdaptiveListingSchema("product");
const baseInput = {
  targetBusinessId: ids.business,
  expectedSchemaId: ids.schema,
  expectedSchemaVersion: 1,
  createIdempotencyKey: ids.token,
  values: {
    title: "Celebration cake",
    description: "A made-to-order cake for birthdays and celebrations.",
    price: "15000",
    availableQuantity: "2",
    fulfilment: ["pickup"],
  },
};

function workspace() {
  return {
    ok: true as const,
    workspace: {
      businessId: ids.business,
      categoryId: ids.category,
      categorySlug: "bakeries",
      mapping: {
        listingTypeId: ids.type,
        listingTypeCode: "product",
        schemaId: ids.schema,
        schemaKey: schema.schemaKey,
        schemaVersion: 1,
      },
      schema,
      selectedDraft: null,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user" } } }),
    },
  });
  mocks.loadWorkspace.mockResolvedValue(workspace());
  mocks.saveDraft.mockResolvedValue({
    ok: true,
    outcome: "created",
    listingId: ids.listing,
    revision: 1,
    savedAt: "2026-08-29T12:00:00.000Z",
  });
});

describe("vendor listing draft boundary", () => {
  it("rejects malformed input before any database access", async () => {
    const result = await saveVendorListingDraft({
      ...baseInput,
      targetBusinessId: "not-a-uuid",
    });

    expect(result.ok).toBe(false);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.loadWorkspace).not.toHaveBeenCalled();
  });

  it("fails closed when no authenticated user is present", async () => {
    mocks.getClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });

    await expect(saveVendorListingDraft(baseInput)).resolves.toMatchObject({
      ok: false,
      code: "unauthorized",
    });
    expect(mocks.loadWorkspace).not.toHaveBeenCalled();
  });

  it("rejects unknown ALE fields before the save RPC", async () => {
    const result = await saveVendorListingDraft({
      ...baseInput,
      values: { ...baseInput.values, injectedSystemField: "draft" },
    });

    expect(result).toMatchObject({ ok: false, code: "validation" });
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("returns a safe conflict for stale schema freshness", async () => {
    const result = await saveVendorListingDraft({
      ...baseInput,
      expectedSchemaVersion: 2,
    });

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "The listing form changed. Refresh it before saving your draft.",
    });
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("returns only the safe save acknowledgement", async () => {
    const result = await saveVendorListingDraft(baseInput);

    expect(result).toEqual({
      ok: true,
      outcome: "created",
      listingId: ids.listing,
      revision: 1,
      savedAt: "2026-08-29T12:00:00.000Z",
    });
    expect(mocks.saveDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ createIdempotencyKey: ids.token }),
      "celebration-cake",
    );
  });

  it.each([
    [
      "rate_limited",
      "Draft saving is temporarily limited. Wait a few minutes, then try again.",
    ],
    [
      "draft_limit",
      "This business has reached its unpublished draft limit. Review existing drafts before creating another.",
    ],
  ] as const)("returns a safe %s message", async (reason, message) => {
    mocks.saveDraft.mockResolvedValue({ ok: false, reason });

    await expect(saveVendorListingDraft(baseInput)).resolves.toEqual({
      ok: false,
      code: reason,
      message,
    });
  });
});
