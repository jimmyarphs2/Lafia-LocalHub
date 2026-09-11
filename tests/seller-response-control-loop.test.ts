import { describe, expect, it } from "vitest";

import {
  ATLAS_ORCHESTRATOR,
  IdempotencyConflictError,
  ORDERGUARD_CASE_AGENT,
  SELLER_REQUEST_MISSED_EVENT,
  SELLER_REQUEST_SENT_EVENT,
  SELLER_RESPONDED_EVENT,
  SHOPKEEPER_COMMUNICATION_AGENT,
  SimulatorOrbitEventSink,
  createSellerResponseControlLoop,
  type SellerResponseEvent,
  type SellerResponseEventSink,
} from "@/lib/orbit/seller-response-control-loop";

const requestInput = {
  caseId: "lh-case-order-123",
  orderId: "order-123",
  sellerId: "seller-123",
  requestTemplate: "confirm_order_availability" as const,
  idempotencyKey: "request-order-123-v1",
  requestedAt: "2026-09-11T08:00:00Z",
  timeoutAt: "2026-09-11T08:30:00Z",
};

function setup() {
  const sink = new SimulatorOrbitEventSink();
  const loop = createSellerResponseControlLoop({ sink });

  return { loop, sink };
}

describe("LocalHub Seller Response Control Loop v1", () => {
  it("routes one simulator-backed request through the governed agent roles", async () => {
    const { loop, sink } = setup();

    const result = await loop.requestSellerResponse(requestInput);

    expect(result).toMatchObject({
      outcome: "request_sent",
      caseId: requestInput.caseId,
      replayed: false,
    });
    expect(loop.getSimulatorMetrics()).toMatchObject({
      mode: "simulation",
      requestWorkCount: 1,
    });
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      companyId: "localhub",
      type: SELLER_REQUEST_SENT_EVENT,
      subject: {
        aggregateId: requestInput.orderId,
        caseId: requestInput.caseId,
      },
      routing: {
        orchestrator: ATLAS_ORCHESTRATOR,
        caseAgent: ORDERGUARD_CASE_AGENT,
        communicationAgent: SHOPKEEPER_COMMUNICATION_AGENT,
      },
      payload: {
        sellerId: requestInput.sellerId,
        requestTemplate: requestInput.requestTemplate,
        timeoutAt: "2026-09-11T08:30:00.000Z",
        provider: "simulator",
      },
      idempotencyKey: requestInput.idempotencyKey,
      schemaVersion: "1.0.0",
    });
    expect(Object.isFrozen(sink.events[0])).toBe(true);
    expect(Object.isFrozen(sink.events[0].routing)).toBe(true);

    expect(loop.getCase(requestInput.caseId)).toMatchObject({
      status: "awaiting_seller",
      orchestrator: ATLAS_ORCHESTRATOR,
      caseAgent: ORDERGUARD_CASE_AGENT,
      communicationAgent: SHOPKEEPER_COMMUNICATION_AGENT,
    });
    expect(loop.getAuditEvidence(requestInput.caseId)).toEqual([
      expect.objectContaining({
        action: SELLER_REQUEST_SENT_EVENT,
        caseId: requestInput.caseId,
        idempotencyKey: requestInput.idempotencyKey,
        evidence: expect.objectContaining({ provider: "simulator" }),
      }),
    ]);
  });

  it("does not duplicate provider work, events, cases, or audit evidence on sequential and concurrent retries", async () => {
    const { loop, sink } = setup();

    const [first, concurrentRetry] = await Promise.all([
      loop.requestSellerResponse(requestInput),
      loop.requestSellerResponse(requestInput),
    ]);
    const laterRetry = await loop.requestSellerResponse(requestInput);

    expect([first.replayed, concurrentRetry.replayed].sort()).toEqual([
      false,
      true,
    ]);
    expect(laterRetry).toMatchObject({
      outcome: "request_sent",
      replayed: true,
    });
    expect(loop.getSimulatorMetrics()).toMatchObject({
      requestAttemptCount: 1,
      requestWorkCount: 1,
    });
    expect(sink.ingestAttemptCount).toBe(1);
    expect(sink.events).toHaveLength(1);
    expect(loop.getAuditEvidence(requestInput.caseId)).toHaveLength(1);
  });

  it("recovers from a sink commit-then-throw without duplicating admitted work", async () => {
    const admitted = new Map<string, SellerResponseEvent>();
    let ingestAttemptCount = 0;
    let throwAfterFirstCommit = true;
    const sink: SellerResponseEventSink = {
      idempotency: "required",
      async ingest(event) {
        ingestAttemptCount += 1;
        admitted.set(event.idempotencyKey, event);
        if (throwAfterFirstCommit) {
          throwAfterFirstCommit = false;
          throw new Error("simulated uncertain sink result");
        }
        return { accepted: true };
      },
    };
    const loop = createSellerResponseControlLoop({ sink });

    await expect(loop.requestSellerResponse(requestInput)).rejects.toThrow(
      /uncertain sink result/i,
    );
    await expect(
      loop.requestSellerResponse(requestInput),
    ).resolves.toMatchObject({
      outcome: "request_sent",
      replayed: false,
    });

    expect(ingestAttemptCount).toBe(2);
    expect(admitted.size).toBe(1);
    expect(loop.getSimulatorMetrics()).toMatchObject({
      requestAttemptCount: 2,
      requestWorkCount: 1,
    });
    expect(loop.getAuditEvidence(requestInput.caseId)).toHaveLength(1);
    expect(loop.getCase(requestInput.caseId)?.status).toBe("awaiting_seller");
  });

  it("rejects reuse of an idempotency key for different work", async () => {
    const { loop, sink } = setup();
    await loop.requestSellerResponse(requestInput);

    await expect(
      loop.requestSellerResponse({
        ...requestInput,
        sellerId: "seller-456",
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    expect(loop.getSimulatorMetrics().requestWorkCount).toBe(1);
    expect(sink.events).toHaveLength(1);
    expect(loop.getAuditEvidence(requestInput.caseId)).toHaveLength(1);
  });

  it("serializes one idempotency key across different cases with an asynchronous sink", async () => {
    const events: SellerResponseEvent[] = [];
    const loop = createSellerResponseControlLoop({
      sink: {
        idempotency: "required",
        async ingest(event) {
          await Promise.resolve();
          events.push(event);
        },
      },
    });
    const secondRequest = {
      ...requestInput,
      caseId: "lh-case-order-456",
      orderId: "order-456",
      sellerId: "seller-456",
      idempotencyKey: "request-order-456-v1",
    };
    await Promise.all([
      loop.requestSellerResponse(requestInput),
      loop.requestSellerResponse(secondRequest),
    ]);

    const results = await Promise.allSettled([
      loop.recordSellerResponse({
        caseId: requestInput.caseId,
        response: "accepted",
        idempotencyKey: "shared-response-key",
        respondedAt: "2026-09-11T08:12:00Z",
      }),
      loop.recordSellerResponse({
        caseId: secondRequest.caseId,
        response: "declined",
        idempotencyKey: "shared-response-key",
        respondedAt: "2026-09-11T08:13:00Z",
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: expect.any(IdempotencyConflictError) });
    expect(
      events.filter((event) => event.type === SELLER_RESPONDED_EVENT),
    ).toHaveLength(1);
    expect(
      [
        loop.getCase(requestInput.caseId)?.status,
        loop.getCase(secondRequest.caseId)?.status,
      ].sort(),
    ).toEqual(["awaiting_seller", "seller_responded"]);
  });

  it("records a seller response once and prevents timeout fallback after resolution", async () => {
    const { loop, sink } = setup();
    await loop.requestSellerResponse(requestInput);

    const responseInput = {
      caseId: requestInput.caseId,
      response: "accepted" as const,
      idempotencyKey: "response-order-123-v1",
      respondedAt: "2026-09-11T08:12:00Z",
    };
    const first = await loop.recordSellerResponse(responseInput);
    const retry = await loop.recordSellerResponse(responseInput);
    const timeout = await loop.processSellerResponseTimeout({
      caseId: requestInput.caseId,
      idempotencyKey: "timeout-order-123-v1",
      observedAt: "2026-09-11T08:31:00Z",
    });

    expect(first).toMatchObject({
      outcome: "seller_responded",
      replayed: false,
    });
    expect(retry).toMatchObject({
      outcome: "seller_responded",
      replayed: true,
    });
    expect(timeout).toEqual({
      caseId: requestInput.caseId,
      outcome: "already_resolved",
      replayed: false,
    });
    expect(loop.getSimulatorMetrics().fallbackWorkCount).toBe(0);
    expect(sink.events.map((event) => event.type)).toEqual([
      SELLER_REQUEST_SENT_EVENT,
      SELLER_RESPONDED_EVENT,
    ]);
    expect(loop.getAuditEvidence(requestInput.caseId)).toHaveLength(2);
    expect(loop.getCase(requestInput.caseId)).toMatchObject({
      status: "seller_responded",
      response: "accepted",
    });
  });

  it("emits one missed event and queues one manual fallback when timeout retries race", async () => {
    const { loop, sink } = setup();
    await loop.requestSellerResponse(requestInput);

    const earlyTimeoutInput = {
      caseId: requestInput.caseId,
      idempotencyKey: "timeout-probe-order-123-v1",
      observedAt: "2026-09-11T08:29:59Z",
    };
    await expect(
      loop.processSellerResponseTimeout(earlyTimeoutInput),
    ).resolves.toEqual({
      caseId: requestInput.caseId,
      outcome: "not_due",
      replayed: false,
    });
    await expect(
      loop.processSellerResponseTimeout(earlyTimeoutInput),
    ).resolves.toEqual({
      caseId: requestInput.caseId,
      outcome: "not_due",
      replayed: true,
    });
    await expect(
      loop.processSellerResponseTimeout({
        ...earlyTimeoutInput,
        observedAt: "2026-09-11T08:29:58Z",
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    const timeoutInput = {
      caseId: requestInput.caseId,
      idempotencyKey: "timeout-due-order-123-v1",
      observedAt: "2026-09-11T08:31:00Z",
    };
    const [first, concurrentRetry] = await Promise.all([
      loop.processSellerResponseTimeout(timeoutInput),
      loop.processSellerResponseTimeout(timeoutInput),
    ]);
    const laterRetry = await loop.processSellerResponseTimeout(timeoutInput);

    expect([first.replayed, concurrentRetry.replayed].sort()).toEqual([
      false,
      true,
    ]);
    expect(laterRetry).toMatchObject({
      outcome: "fallback_queued",
      replayed: true,
    });
    expect(loop.getSimulatorMetrics()).toMatchObject({
      fallbackAttemptCount: 1,
      fallbackWorkCount: 1,
    });
    expect(sink.events.map((event) => event.type)).toEqual([
      SELLER_REQUEST_SENT_EVENT,
      SELLER_REQUEST_MISSED_EVENT,
    ]);
    expect(loop.getAuditEvidence(requestInput.caseId)).toHaveLength(2);
    expect(loop.getCase(requestInput.caseId)).toMatchObject({
      status: "fallback_queued",
      fallback: "manual_review",
    });
  });

  it.each([
    "2026-09-11T07:59:59Z",
    "2026-09-11T08:30:00Z",
    "2026-09-11T08:30:01Z",
  ])(
    "rejects a seller response outside the active window: %s",
    async (respondedAt) => {
      const { loop, sink } = setup();
      await loop.requestSellerResponse(requestInput);

      await expect(
        loop.recordSellerResponse({
          caseId: requestInput.caseId,
          response: "accepted",
          idempotencyKey: `response-${respondedAt}`,
          respondedAt,
        }),
      ).rejects.toThrow(/active response window/i);

      expect(sink.events.map((event) => event.type)).toEqual([
        SELLER_REQUEST_SENT_EVENT,
      ]);
      expect(loop.getCase(requestInput.caseId)?.status).toBe("awaiting_seller");
    },
  );

  it("serializes response and timeout races so only one terminal path wins", async () => {
    const { loop, sink } = setup();
    await loop.requestSellerResponse(requestInput);

    const outcomes = await Promise.allSettled([
      loop.recordSellerResponse({
        caseId: requestInput.caseId,
        response: "accepted",
        idempotencyKey: "response-race-order-123-v1",
        respondedAt: "2026-09-11T08:12:00Z",
      }),
      loop.processSellerResponseTimeout({
        caseId: requestInput.caseId,
        idempotencyKey: "timeout-race-order-123-v1",
        observedAt: "2026-09-11T08:31:00Z",
      }),
    ]);

    const terminalEvents = sink.events.filter(
      (event) =>
        event.type === SELLER_RESPONDED_EVENT ||
        event.type === SELLER_REQUEST_MISSED_EVENT,
    );
    expect(terminalEvents).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected").length,
    ).toBeLessThanOrEqual(1);
    expect(loop.getAuditEvidence(requestInput.caseId)).toHaveLength(2);
  });

  it("does not admit an injected provider even when it claims simulation mode", () => {
    expect(() =>
      createSellerResponseControlLoop({
        provider: {
          mode: "simulation",
          sendRequest: async () => {
            throw new Error("must never execute");
          },
          queueManualFallback: async () => {
            throw new Error("must never execute");
          },
        },
        sink: new SimulatorOrbitEventSink(),
      } as never),
    ).toThrow(/provider injection is disabled/i);
  });
});
