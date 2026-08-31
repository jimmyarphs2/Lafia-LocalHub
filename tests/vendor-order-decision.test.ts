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
  parseVendorOrderResponse,
  vendorOrderDecisionIdempotencyKeySchema,
} from "@/lib/orders/contract";
import { respondToVendorOrder } from "@/app/vendor/orders/actions";

const orderId = "66666666-6666-4666-8666-666666666666";
const idempotencyKey = "77777777-7777-4777-8777-777777777777";
const timestamp = "2026-08-30T10:00:00.000Z";

function formData(overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set("order_id", overrides.order_id ?? orderId);
  form.set("decision", overrides.decision ?? "confirm");
  form.set("idempotency_key", overrides.idempotency_key ?? idempotencyKey);
  return form;
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "transitioned",
    retryable: false,
    order_id: orderId,
    status: "confirmed",
    vendor_decided_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

describe("vendor order decision contract", () => {
  it("accepts UUIDv4 keys and rejects status/timestamp projection drift", () => {
    expect(
      vendorOrderDecisionIdempotencyKeySchema.safeParse(idempotencyKey).success,
    ).toBe(true);
    expect(
      vendorOrderDecisionIdempotencyKeySchema.safeParse(
        "77777777-7777-1777-8777-777777777777",
      ).success,
    ).toBe(false);
    expect(
      vendorOrderDecisionIdempotencyKeySchema.safeParse(
        "77777777-7777-4777-8777-77777777777A",
      ).success,
    ).toBe(false);
    expect(parseVendorOrderResponse(response())).toMatchObject({
      outcome: "transitioned",
      status: "confirmed",
    });
    expect(parseVendorOrderResponse(response({ status: "placed" }))).toBeNull();
    expect(
      parseVendorOrderResponse(response({ vendor_decided_at: null })),
    ).toBeNull();
    expect(
      parseVendorOrderResponse(
        response({ updated_at: "2026-08-30T10:01:00.000Z" }),
      ),
    ).toBeNull();
  });
});

describe("vendor order decision server action", () => {
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

  it("rejects duplicate direct-POST form fields before configuration or RPC", async () => {
    const form = formData();
    form.append("decision", "cancel");

    await expect(respondToVendorOrder(null, form)).resolves.toMatchObject({
      ok: false,
      code: "validation",
      retryable: false,
    });
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed without an authenticated actor", async () => {
    mocks.getClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      rpc: mocks.rpc,
    });

    await expect(respondToVendorOrder(null, formData())).resolves.toMatchObject(
      {
        ok: false,
        code: "unauthorized",
        retryable: false,
      },
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reuses the client key after a retryable failure", async () => {
    mocks.rpc.mockRejectedValue(new Error("offline"));

    await expect(respondToVendorOrder(null, formData())).resolves.toMatchObject(
      {
        ok: false,
        code: "unavailable",
        retryable: true,
      },
    );
    expect(mocks.rpc).toHaveBeenCalledWith("respond_to_listing_order", {
      p_order_id: orderId,
      p_decision: "confirm",
      p_idempotency_key: idempotencyKey,
    });
  });

  it("returns safe confirmation feedback and revalidates only canonical order routes", async () => {
    await expect(respondToVendorOrder(null, formData())).resolves.toEqual({
      ok: true,
      code: "transitioned",
      message:
        "Vendor availability has been recorded. No payment has been collected and fulfilment has not started.",
      retryable: false,
      status: "confirmed",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/vendor/orders");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/vendor/orders/[order]",
      "page",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/[market]/orders",
      "page",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/[market]/orders/[order]",
      "page",
    );
  });

  it("rejects a parsed response bound to a different order without revalidation", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        response({
          order_id: "88888888-8888-4888-8888-888888888888",
        }),
      ],
      error: null,
    });

    await expect(respondToVendorOrder(null, formData())).resolves.toMatchObject(
      {
        ok: false,
        code: "malformed_response",
        retryable: true,
      },
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not revalidate malformed or definitive terminal results", async () => {
    mocks.rpc.mockResolvedValue({ data: response(), error: null });
    await expect(respondToVendorOrder(null, formData())).resolves.toMatchObject(
      {
        ok: false,
        code: "unavailable",
        retryable: true,
      },
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();

    mocks.rpc.mockResolvedValue({
      data: [
        response({
          outcome: "already_transitioned",
        }),
      ],
      error: null,
    });
    await expect(respondToVendorOrder(null, formData())).resolves.toMatchObject(
      {
        ok: false,
        code: "already_transitioned",
        retryable: false,
      },
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
