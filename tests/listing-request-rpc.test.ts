import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getCustomerListingRequest,
  listCustomerListingRequests,
  listVendorListingRequests,
} from "@/lib/requests/rpc";

const requestId = "66666666-6666-4666-8666-666666666666";
const timestamp = "2026-08-30T10:00:00.000Z";
const rpc = vi.fn();
const client = { rpc } as never;

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    request_id: requestId,
    request_number: "LR-260830-0000000001",
    listing_id: requestId,
    requested_action: "enquire",
    status: "open",
    created_at: timestamp,
    vendor_responded_at: null,
    listing_title: "Safe listing",
    market_slug: "lafia",
    vendor_name: "Safe vendor",
    ...overrides,
  };
}

beforeEach(() => {
  rpc.mockReset();
});

describe("listing request RPC adapters", () => {
  it("preserves a legitimate empty list without reporting a provider error", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await expect(listCustomerListingRequests(client, "lafia")).resolves.toEqual(
      {
        requests: [],
        error: null,
      },
    );
  });

  it("fails the whole list when any row violates the presentation contract", async () => {
    rpc.mockResolvedValue({
      data: [requestRow(), requestRow({ request_number: "malformed" })],
      error: null,
    });

    const result = await listVendorListingRequests(client);
    expect(result.requests).toEqual([]);
    expect(result.error).toBeInstanceOf(Error);
  });

  it("rejects object-shaped optional-row responses as contract drift", async () => {
    rpc.mockResolvedValue({ data: requestRow(), error: null });

    const result = await getCustomerListingRequest(client, requestId);
    expect(result.request).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it("accepts exactly one optional-row array", async () => {
    rpc.mockResolvedValue({ data: [requestRow()], error: null });

    const result = await getCustomerListingRequest(client, requestId);
    expect(result.error).toBeNull();
    expect(result.request).toMatchObject({ id: requestId, status: "open" });
  });
});
