import { describe, expect, it, vi } from "vitest";

import { dispatchToolGatewayRequest } from "@/lib/tools/dispatcher";
import type { PlatformSummaryResult } from "@/lib/tools/contract";

const invocationId = "9b25ec57-65d3-48bc-bcfa-92ac7f44eb2f";
const auditEventId = "93237679-dc05-409e-a38d-bab465c94ac4";
const marketId = "0677df4f-65f2-41e9-aa01-27bb70788358";

function dependencies(
  overrides: Partial<Parameters<typeof dispatchToolGatewayRequest>[1]> = {},
) {
  return {
    authorize: vi.fn(async () => true),
    adapter: {
      getPlatformSummary: vi.fn(async () => ({
        outcome: "succeeded" as const,
        invocationId,
        auditEventId,
        observedAt: "2026-08-31T12:00:00.000Z",
        data: {
          market: {
            id: marketId,
            slug: "lafia",
            name: "Lafia",
            countryCode: "NG",
            currencyCode: "NGN",
            timezone: "Africa/Lagos",
          },
          activeCategoryCount: 4,
          activeVendorCount: 3,
          publishedListingCount: 7,
          orderableListingCount: 2,
        },
      })),
    },
    observe: vi.fn(),
    randomUUID: () => invocationId,
    ...overrides,
  };
}

const request = {
  contractVersion: 1,
  tool: "get_platform_summary",
  input: { marketSlug: "lafia" },
} as const;

describe("provider-neutral tool dispatcher", () => {
  it("rejects malformed input before authentication or adapter execution", async () => {
    const deps = dependencies();
    const result = await dispatchToolGatewayRequest(
      { ...request, input: { marketSlug: "//attacker" } },
      deps,
    );

    expect(result).toEqual({
      ok: false,
      contractVersion: 1,
      invocationId,
      tool: null,
      error: { code: "invalid_request", retryable: false },
    });
    expect(deps.authorize).not.toHaveBeenCalled();
    expect(deps.adapter.getPlatformSummary).not.toHaveBeenCalled();
    expect(deps.observe).toHaveBeenCalledWith({
      invocationId,
      tool: null,
      outcome: "invalid_request",
    });
    expect(JSON.stringify(vi.mocked(deps.observe).mock.calls)).not.toContain(
      "attacker",
    );
  });

  it("fails closed before the adapter when cookie authentication is absent", async () => {
    const deps = dependencies({ authorize: vi.fn(async () => false) });
    const result = await dispatchToolGatewayRequest(request, deps);

    expect(result).toEqual({
      ok: false,
      contractVersion: 1,
      invocationId,
      tool: "get_platform_summary",
      error: { code: "authorization_failed", retryable: false },
    });
    expect(deps.adapter.getPlatformSummary).not.toHaveBeenCalled();
    expect(deps.observe).toHaveBeenCalledWith({
      invocationId,
      tool: "get_platform_summary",
      outcome: "authorization_failed",
    });
  });

  it("returns only the strict audited success envelope and forwards cancellation", async () => {
    const deps = dependencies();
    const controller = new AbortController();
    const result = await dispatchToolGatewayRequest(request, deps, {
      signal: controller.signal,
    });

    expect(deps.adapter.getPlatformSummary).toHaveBeenCalledWith({
      invocationId,
      marketSlug: "lafia",
      signal: expect.any(AbortSignal),
    });
    expect(result).toEqual({
      ok: true,
      contractVersion: 1,
      invocationId,
      tool: "get_platform_summary",
      actionClass: "green",
      auditEventId,
      observedAt: "2026-08-31T12:00:00.000Z",
      data: {
        market: {
          id: marketId,
          slug: "lafia",
          name: "Lafia",
          countryCode: "NG",
          currencyCode: "NGN",
          timezone: "Africa/Lagos",
        },
        activeCategoryCount: 4,
        activeVendorCount: 3,
        publishedListingCount: 7,
        orderableListingCount: 2,
      },
    });
    expect(deps.observe).not.toHaveBeenCalled();
  });

  it("maps bounded database outcomes without exposing market existence or internals", async () => {
    for (const [rpcResult, expected] of [
      [
        {
          outcome: "market_not_found" as const,
          invocationId,
          auditEventId,
          observedAt: "2026-08-31T12:00:00.000Z",
        },
        {
          code: "unavailable",
          retryable: false,
          auditEventId,
        },
      ],
      [
        {
          outcome: "rate_limited" as const,
          invocationId,
          auditEventId: null,
          observedAt: "2026-08-31T12:00:00.000Z",
        },
        { code: "rate_limited", retryable: true, auditEventId: null },
      ],
    ] as const) {
      const deps = dependencies({
        adapter: { getPlatformSummary: vi.fn(async () => rpcResult) },
      });
      const result = await dispatchToolGatewayRequest(request, deps);

      expect(result).toEqual({
        ok: false,
        contractVersion: 1,
        invocationId,
        tool: "get_platform_summary",
        error: expected,
      });
    }
  });

  it("discards dependency exceptions and logs no raw error or market input", async () => {
    const deps = dependencies({
      adapter: {
        getPlatformSummary: vi.fn(async () => {
          throw new Error("secret-provider-detail");
        }),
      },
    });
    const result = await dispatchToolGatewayRequest(request, deps);

    expect(result).toEqual({
      ok: false,
      contractVersion: 1,
      invocationId,
      tool: "get_platform_summary",
      error: { code: "unavailable", retryable: true },
    });
    expect(deps.observe).toHaveBeenCalledWith({
      invocationId,
      tool: "get_platform_summary",
      outcome: "dependency_failed",
    });
    const observed = JSON.stringify(vi.mocked(deps.observe).mock.calls);
    expect(observed).not.toContain("secret-provider-detail");
    expect(observed).not.toContain("lafia");
  });

  it("aborts once at the fixed deadline and ignores a late dependency result", async () => {
    vi.useFakeTimers();
    try {
      let dependencySignal: AbortSignal | undefined;
      const deps = dependencies({
        adapter: {
          getPlatformSummary: vi.fn(
            ({ signal }) =>
              new Promise<PlatformSummaryResult>((resolve) => {
                dependencySignal = signal;
                setTimeout(
                  () =>
                    resolve({
                      outcome: "succeeded",
                      invocationId,
                      auditEventId,
                      observedAt: "2026-08-31T12:00:09.000Z",
                      data: {
                        market: {
                          id: marketId,
                          slug: "lafia",
                          name: "Lafia",
                          countryCode: "NG",
                          currencyCode: "NGN",
                          timezone: "Africa/Lagos",
                        },
                        activeCategoryCount: 4,
                        activeVendorCount: 3,
                        publishedListingCount: 7,
                        orderableListingCount: 2,
                      },
                    }),
                  9_000,
                );
              }),
          ),
        },
      });
      const resultPromise = dispatchToolGatewayRequest(request, deps);

      await vi.advanceTimersByTimeAsync(5_000);
      await expect(resultPromise).resolves.toEqual({
        ok: false,
        contractVersion: 1,
        invocationId,
        tool: "get_platform_summary",
        error: { code: "timeout", retryable: true },
      });
      expect(dependencySignal?.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(4_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
