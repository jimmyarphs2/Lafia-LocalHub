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

import { startVendorOrderFulfilment } from "@/app/vendor/orders/fulfilment-actions";

const orderId = "66666666-6666-4666-8666-666666666666";
const idempotencyKey = "77777777-7777-4777-8777-777777777777";
const fulfilmentId = "88888888-8888-4888-8888-888888888888";
const timestamp = "2026-08-30T10:00:00.000Z";

function formData(overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set("order_id", overrides.order_id ?? orderId);
  form.set("idempotency_key", overrides.idempotency_key ?? idempotencyKey);
  return form;
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "started",
    retryable: false,
    order_id: orderId,
    order_status: "confirmed",
    fulfilment_id: fulfilmentId,
    fulfilment_status: "processing",
    fulfilment_started_at: timestamp,
    fulfilment_updated_at: timestamp,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "vendor" } } }),
    },
    rpc: mocks.rpc,
  });
  mocks.rpc.mockResolvedValue({ data: [response()], error: null });
});

describe("vendor order fulfilment server action", () => {
  it("rejects malformed or duplicate direct-POST fields before client access", async () => {
    const duplicate = formData();
    duplicate.append("order_id", orderId);

    await expect(
      startVendorOrderFulfilment(null, duplicate),
    ).resolves.toMatchObject({
      ok: false,
      code: "validation",
      retryable: false,
    });
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed without an authenticated vendor", async () => {
    mocks.getClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      rpc: mocks.rpc,
    });

    await expect(
      startVendorOrderFulfilment(null, formData()),
    ).resolves.toMatchObject({
      ok: false,
      code: "unauthorized",
      retryable: false,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["started", "replayed", "already_started"] as const)(
    "accepts bound canonical %s processing and revalidates safe order views",
    async (outcome) => {
      mocks.rpc.mockResolvedValue({
        data: [response({ outcome })],
        error: null,
      });
      await expect(
        startVendorOrderFulfilment(null, formData()),
      ).resolves.toMatchObject({
        ok: true,
        code: outcome,
        status: "processing",
      });
      expect(mocks.rpc).toHaveBeenCalledWith("start_listing_order_fulfilment", {
        p_order_id: orderId,
        p_idempotency_key: idempotencyKey,
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
    },
  );

  it("keeps the same key for retryable provider failures", async () => {
    mocks.rpc
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: [response()], error: null });
    await expect(
      startVendorOrderFulfilment(null, formData()),
    ).resolves.toMatchObject({
      ok: false,
      code: "unavailable",
      retryable: true,
    });
    await expect(
      startVendorOrderFulfilment(null, formData()),
    ).resolves.toMatchObject({ ok: true, code: "started" });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    for (const call of mocks.rpc.mock.calls) {
      expect(call).toEqual([
        "start_listing_order_fulfilment",
        { p_order_id: orderId, p_idempotency_key: idempotencyKey },
      ]);
    }
  });

  it("rejects a wrong-order or incoherent response without revalidation", async () => {
    mocks.rpc.mockResolvedValue({
      data: [response({ order_id: "99999999-9999-4999-8999-999999999999" })],
      error: null,
    });
    await expect(
      startVendorOrderFulfilment(null, formData()),
    ).resolves.toMatchObject({
      ok: false,
      code: "malformed_response",
      retryable: true,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();

    mocks.rpc.mockResolvedValue({
      data: [response({ fulfilment_updated_at: "2026-08-30T10:01:00.000Z" })],
      error: null,
    });
    await expect(
      startVendorOrderFulfilment(null, formData()),
    ).resolves.toMatchObject({
      ok: false,
      code: "unavailable",
      retryable: true,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
