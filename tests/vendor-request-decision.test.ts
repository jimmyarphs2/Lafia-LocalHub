import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: mocks.getClient,
}));

import {
  parseListingRequest,
  parseVendorRequestResponse,
  vendorDecisionIdempotencyKeySchema,
} from "@/lib/requests/contract";
import { respondToVendorRequest } from "@/app/vendor/requests/actions";

const requestId = "66666666-6666-4666-8666-666666666666";
const idempotencyKey = "77777777-7777-4777-8777-777777777777";
const timestamp = "2026-08-30T10:00:00.000Z";

function formData(overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set("request_id", overrides.request_id ?? requestId);
  form.set("decision", overrides.decision ?? "accept");
  form.set("idempotency_key", overrides.idempotency_key ?? idempotencyKey);
  return form;
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "transitioned",
    retryable: false,
    request_id: requestId,
    status: "accepted",
    vendor_responded_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

describe("vendor request decision contract", () => {
  it("accepts only version 4 idempotency keys", () => {
    expect(
      vendorDecisionIdempotencyKeySchema.safeParse(idempotencyKey).success,
    ).toBe(true);
    expect(
      vendorDecisionIdempotencyKeySchema.safeParse(
        "77777777-7777-1777-8777-777777777777",
      ).success,
    ).toBe(false);
  });

  it("exposes the vendor response timestamp and rejects array or unknown statuses", () => {
    expect(
      parseListingRequest({
        id: requestId,
        request_number: "LR-260830-0000000001",
        listing_id: requestId,
        requested_action: "enquire",
        status: "accepted",
        created_at: timestamp,
        vendor_responded_at: timestamp,
      }),
    ).toMatchObject({ status: "accepted", vendorRespondedAt: timestamp });
    expect(
      parseListingRequest([
        {
          id: requestId,
          request_number: "LR-260830-0000000001",
          listing_id: requestId,
          requested_action: "enquire",
          status: "open",
          created_at: timestamp,
        },
      ]),
    ).toBeNull();
  });

  it("fails closed for malformed or incoherent decision RPC rows", () => {
    expect(parseVendorRequestResponse(response())).toMatchObject({
      outcome: "transitioned",
      status: "accepted",
    });
    expect(parseVendorRequestResponse(response({ status: "open" }))).toBeNull();
    expect(
      parseVendorRequestResponse(response({ vendor_responded_at: null })),
    ).toBeNull();
    expect(parseVendorRequestResponse([response()])).toBeNull();
    expect(
      parseVendorRequestResponse(
        response({ outcome: "not_found", request_id: requestId }),
      ),
    ).toBeNull();
  });
});

describe("vendor request decision server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "v" } } }),
      },
      rpc: mocks.rpc,
    });
    mocks.rpc.mockResolvedValue({ data: [response()], error: null });
  });

  it("rejects direct POST input before reaching configuration or RPC", async () => {
    await expect(
      respondToVendorRequest(null, formData({ request_id: "not-a-uuid" })),
    ).resolves.toMatchObject({
      ok: false,
      code: "validation",
      retryable: false,
    });
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when no authenticated vendor session exists", async () => {
    mocks.getClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      rpc: mocks.rpc,
    });

    await expect(
      respondToVendorRequest(null, formData()),
    ).resolves.toMatchObject({
      ok: false,
      code: "unauthorized",
      retryable: false,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps the same client idempotency key through a retryable RPC failure", async () => {
    mocks.rpc.mockRejectedValue(new Error("offline"));

    await expect(
      respondToVendorRequest(null, formData()),
    ).resolves.toMatchObject({
      ok: false,
      code: "unavailable",
      retryable: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("respond_to_listing_request", {
      p_request_id: requestId,
      p_decision: "accept",
      p_idempotency_key: idempotencyKey,
    });
  });

  it("returns safe success and revalidates only route patterns after an authoritative transition", async () => {
    await expect(respondToVendorRequest(null, formData())).resolves.toEqual({
      ok: true,
      code: "transitioned",
      message:
        "Vendor response saved. This starts follow-up only; no booking, order, or payment was created.",
      retryable: false,
      status: "accepted",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/vendor/requests");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/[market]/requests",
      "page",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/[market]/requests/[request]",
      "page",
    );
  });

  it("rejects an object-shaped response instead of accepting PostgREST contract drift", async () => {
    mocks.rpc.mockResolvedValue({ data: response(), error: null });

    await expect(
      respondToVendorRequest(null, formData()),
    ).resolves.toMatchObject({
      ok: false,
      code: "unavailable",
      retryable: true,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps database throttling to safe retry feedback", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        response({
          outcome: "rate_limited",
          retryable: true,
          request_id: null,
          status: null,
          vendor_responded_at: null,
          updated_at: null,
        }),
      ],
      error: null,
    });

    await expect(
      respondToVendorRequest(null, formData()),
    ).resolves.toMatchObject({
      ok: false,
      code: "rate_limited",
      retryable: true,
    });
  });

  it.each(["not_found", "invalid", "idempotency_key_reused"] as const)(
    "maps %s to a non-disclosing definitive response",
    async (outcome) => {
      mocks.rpc.mockResolvedValue({
        data: [
          response({
            outcome,
            request_id: null,
            status: null,
            vendor_responded_at: null,
            updated_at: null,
          }),
        ],
        error: null,
      });

      await expect(
        respondToVendorRequest(null, formData()),
      ).resolves.toMatchObject({
        ok: false,
        code: outcome,
        retryable: false,
      });
    },
  );
});
