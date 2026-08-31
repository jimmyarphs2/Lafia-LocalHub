import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getAdaptiveListingSchema } from "@/lib/ale/registry";
import { saveListingDraft } from "@/lib/listings/persistence";
import {
  loadVendorListingDraftWorkspace,
  parseVendorListingDraftWorkspace,
} from "@/lib/listings/workspace";

const ids = {
  business: "2dd03116-25d7-4f36-9a1f-314cad75f5db",
  listing: "5e5e77cd-45dc-4f36-9a1f-314cad75f5db",
  schema: "8a3a1f73-3ed5-45a0-a86e-c1cef1f842d7",
  type: "11ab2117-4da5-4b59-ae5b-4ed12ddf7b1a",
  category: "10ab2117-4da5-4b59-ae5b-4ed12ddf7b1a",
  token: "26aa9e8f-1f6c-4eb2-bb97-e151f1c63e45",
};
const schema = getAdaptiveListingSchema("product");
const input = {
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

function contextRow(overrides: Record<string, unknown> = {}) {
  return {
    mode: "create",
    listing_id: null,
    business_id: ids.business,
    draft_revision: null,
    slug: null,
    category_id: ids.category,
    category_slug: "bakeries",
    listing_type_id: ids.type,
    listing_type_code: "product",
    listing_schema_id: ids.schema,
    schema_key: schema.schemaKey,
    schema_version: schema.schemaVersion,
    schema_document: schema,
    values: null,
    updated_at: null,
    ...overrides,
  };
}

describe("listing draft RPC adapters", () => {
  it("does not accept a foreign context row", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: contextRow({ business_id: ids.type }),
        error: null,
      }),
    };

    await expect(
      loadVendorListingDraftWorkspace(client as never, {
        targetBusinessId: ids.business,
      }),
    ).resolves.toEqual({ ok: false, reason: "listing_unavailable" });
  });

  it("rejects an unavailable or malformed authoritative schema", () => {
    expect(
      parseVendorListingDraftWorkspace(contextRow({ schema_document: {} })),
    ).toBeNull();
  });

  it("forwards a create idempotency UUID only to the create RPC shape", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          listing_id: ids.listing,
          business_id: ids.business,
          draft_revision: 1,
          listing_schema_id: ids.schema,
          schema_key: schema.schemaKey,
          schema_version: 1,
          created_at: "2026-08-29T12:00:00.000Z",
          updated_at: "2026-08-29T12:00:00.000Z",
        },
      ],
      error: null,
    });

    await saveListingDraft({ rpc } as never, input, "celebration-cake");

    expect(rpc).toHaveBeenCalledWith(
      "save_listing_draft",
      expect.objectContaining({
        p_business_id: ids.business,
        p_idempotency_key: ids.token,
        p_payload: expect.objectContaining({
          slug: "celebration-cake",
          values: input.values,
        }),
      }),
    );
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_listing_id");
  });

  it("maps stale revision errors to a safe conflict", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "draft_revision_conflict", message: "internal details" },
    });

    await expect(
      saveListingDraft({ rpc } as never, input, "cake"),
    ).resolves.toEqual({
      ok: false,
      reason: "conflict",
    });
  });

  it.each([
    ["draft_create_rate_limit_exceeded", "rate_limited"],
    ["draft_save_rate_limit_exceeded", "rate_limited"],
    ["draft_open_limit_exceeded", "draft_limit"],
  ] as const)(
    "maps %s without exposing database details",
    async (code, reason) => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "P0001", message: `${code}: internal details` },
      });

      await expect(
        saveListingDraft({ rpc } as never, input, "cake"),
      ).resolves.toEqual({ ok: false, reason });
    },
  );
});
