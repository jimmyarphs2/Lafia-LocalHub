import {
  LOCALHUB_ORBIT_COMPANY_ID,
  type OrbitEventSink,
} from "@/lib/orbit/localhub-bridge";

export const ATLAS_ORCHESTRATOR = "ATLAS" as const;
export const ORDERGUARD_CASE_AGENT = "ORDERGUARD" as const;
export const SHOPKEEPER_COMMUNICATION_AGENT = "SHOPKEEPER" as const;

export const SELLER_REQUEST_SENT_EVENT = "seller.request_sent" as const;
export const SELLER_RESPONDED_EVENT = "seller.responded" as const;
export const SELLER_REQUEST_MISSED_EVENT = "seller.request_missed" as const;

const SELLER_REQUEST_TEMPLATE = "confirm_order_availability" as const;
const MAX_IDENTIFIER_LENGTH = 160;

export type SellerResponseEventType =
  | typeof SELLER_REQUEST_SENT_EVENT
  | typeof SELLER_RESPONDED_EVENT
  | typeof SELLER_REQUEST_MISSED_EVENT;

export type SellerResponseEvent = Readonly<{
  companyId: typeof LOCALHUB_ORBIT_COMPANY_ID;
  type: SellerResponseEventType;
  occurredAt: string;
  source: Readonly<{ system: "localhub"; eventId: string }>;
  subject: Readonly<{ aggregateId: string; caseId: string }>;
  routing: Readonly<{
    orchestrator: typeof ATLAS_ORCHESTRATOR;
    caseAgent: typeof ORDERGUARD_CASE_AGENT;
    communicationAgent: typeof SHOPKEEPER_COMMUNICATION_AGENT;
  }>;
  payload: Readonly<Record<string, string | boolean | null>>;
  idempotencyKey: string;
  schemaVersion: "1.0.0";
}>;

export interface SellerResponseEventSink extends OrbitEventSink<SellerResponseEvent> {
  readonly idempotency: "required";
}

type RequestInput = {
  caseId: string;
  orderId: string;
  sellerId: string;
  requestTemplate: typeof SELLER_REQUEST_TEMPLATE;
  idempotencyKey: string;
  requestedAt: string;
  timeoutAt: string;
};

type ResponseInput = {
  caseId: string;
  response: "accepted" | "declined";
  idempotencyKey: string;
  respondedAt: string;
};

type TimeoutInput = {
  caseId: string;
  idempotencyKey: string;
  observedAt: string;
};

type RequestResult = Readonly<{
  caseId: string;
  outcome: "request_sent";
  providerRequestId: string;
  replayed: boolean;
}>;

type ResponseResult = Readonly<{
  caseId: string;
  outcome: "seller_responded";
  replayed: boolean;
}>;

type TimeoutResult = Readonly<{
  caseId: string;
  outcome: "not_due" | "already_resolved" | "fallback_queued";
  replayed: boolean;
}>;

type CommandResult = RequestResult | ResponseResult | TimeoutResult;

type MutableSellerResponseCase = {
  caseId: string;
  orderId: string;
  sellerId: string;
  requestTemplate: typeof SELLER_REQUEST_TEMPLATE;
  requestedAt: string;
  timeoutAt: string;
  status: "awaiting_seller" | "seller_responded" | "fallback_queued";
  response: "accepted" | "declined" | null;
  respondedAt: string | null;
  fallback: "manual_review" | null;
  providerRequestId: string;
  fallbackReference: string | null;
};

export type SellerResponseCaseSnapshot = Readonly<
  MutableSellerResponseCase & {
    orchestrator: typeof ATLAS_ORCHESTRATOR;
    caseAgent: typeof ORDERGUARD_CASE_AGENT;
    communicationAgent: typeof SHOPKEEPER_COMMUNICATION_AGENT;
  }
>;

export type SellerResponseAuditEvidence = Readonly<{
  auditId: string;
  caseId: string;
  action: SellerResponseEventType;
  occurredAt: string;
  idempotencyKey: string;
  orchestrator: typeof ATLAS_ORCHESTRATOR;
  caseAgent: typeof ORDERGUARD_CASE_AGENT;
  communicationAgent: typeof SHOPKEEPER_COMMUNICATION_AGENT;
  evidence: Readonly<Record<string, string | boolean | null>>;
}>;

export type SellerResponseSimulatorMetrics = Readonly<{
  mode: "simulation";
  requestAttemptCount: number;
  requestWorkCount: number;
  fallbackAttemptCount: number;
  fallbackWorkCount: number;
}>;

type ProviderRequest = Readonly<{
  caseId: string;
  sellerId: string;
  requestTemplate: typeof SELLER_REQUEST_TEMPLATE;
  idempotencyKey: string;
}>;

type ProviderFallback = Readonly<{
  caseId: string;
  reason: "seller_response_timeout";
  idempotencyKey: string;
}>;

type ProviderRequestReceipt = Readonly<{
  provider: "simulator";
  providerRequestId: string;
}>;

type ProviderFallbackReceipt = Readonly<{
  provider: "simulator";
  fallback: "manual_review";
  fallbackReference: string;
}>;

export interface SimulatorBackedSellerCommunicationProvider {
  readonly mode: "simulation";
  sendRequest(input: ProviderRequest): Promise<ProviderRequestReceipt>;
  queueManualFallback(
    input: ProviderFallback,
  ): Promise<ProviderFallbackReceipt>;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key is already bound to different work");
    this.name = "IdempotencyConflictError";
  }
}

export class SellerResponseCaseStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SellerResponseCaseStateError";
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string`);
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_IDENTIFIER_LENGTH) {
    throw new TypeError(
      `${field} must contain 1-${MAX_IDENTIFIER_LENGTH} characters`,
    );
  }
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new TypeError(`${field} must not contain control characters`);
  }
  return normalized;
}

function caseId(value: unknown): string {
  const normalized = requiredText(value, "caseId");
  if (!/^lh-case-[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u.test(normalized)) {
    throw new TypeError("caseId must use the lh-case-<lowercase-id> format");
  }
  return normalized;
}

function isoTime(value: unknown, field: string): string {
  const normalized = requiredText(value, field);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${field} must be a valid ISO timestamp`);
  }
  return parsed.toISOString();
}

function stableFingerprint(value: unknown): string {
  return JSON.stringify(value);
}

function replayResult<T extends CommandResult>(result: T): T {
  return Object.freeze({ ...result, replayed: true }) as T;
}

function immutableEvent(input: {
  type: SellerResponseEventType;
  caseId: string;
  orderId: string;
  occurredAt: string;
  idempotencyKey: string;
  payload: Record<string, string | boolean | null>;
}): SellerResponseEvent {
  return Object.freeze({
    companyId: LOCALHUB_ORBIT_COMPANY_ID,
    type: input.type,
    occurredAt: input.occurredAt,
    source: Object.freeze({
      system: "localhub" as const,
      eventId: `${input.caseId}:${input.type}`,
    }),
    subject: Object.freeze({
      aggregateId: input.orderId,
      caseId: input.caseId,
    }),
    routing: Object.freeze({
      orchestrator: ATLAS_ORCHESTRATOR,
      caseAgent: ORDERGUARD_CASE_AGENT,
      communicationAgent: SHOPKEEPER_COMMUNICATION_AGENT,
    }),
    payload: Object.freeze({ ...input.payload }),
    idempotencyKey: input.idempotencyKey,
    schemaVersion: "1.0.0" as const,
  });
}

export class SimulatorSellerCommunicationProvider implements SimulatorBackedSellerCommunicationProvider {
  readonly mode = "simulation" as const;
  requestAttemptCount = 0;
  requestWorkCount = 0;
  fallbackAttemptCount = 0;
  fallbackWorkCount = 0;

  readonly #requests = new Map<
    string,
    { fingerprint: string; receipt: ProviderRequestReceipt }
  >();
  readonly #fallbacks = new Map<
    string,
    { fingerprint: string; receipt: ProviderFallbackReceipt }
  >();

  async sendRequest(input: ProviderRequest): Promise<ProviderRequestReceipt> {
    this.requestAttemptCount += 1;
    const fingerprint = stableFingerprint(input);
    const existing = this.#requests.get(input.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new IdempotencyConflictError();
      return existing.receipt;
    }

    const receipt = Object.freeze({
      provider: "simulator" as const,
      providerRequestId: `sim-request:${input.caseId}`,
    });
    this.#requests.set(input.idempotencyKey, { fingerprint, receipt });
    this.requestWorkCount += 1;
    return receipt;
  }

  async queueManualFallback(
    input: ProviderFallback,
  ): Promise<ProviderFallbackReceipt> {
    this.fallbackAttemptCount += 1;
    const fingerprint = stableFingerprint(input);
    const existing = this.#fallbacks.get(input.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new IdempotencyConflictError();
      return existing.receipt;
    }

    const receipt = Object.freeze({
      provider: "simulator" as const,
      fallback: "manual_review" as const,
      fallbackReference: `sim-fallback:${input.caseId}`,
    });
    this.#fallbacks.set(input.idempotencyKey, { fingerprint, receipt });
    this.fallbackWorkCount += 1;
    return receipt;
  }
}

export class SimulatorOrbitEventSink implements SellerResponseEventSink {
  readonly idempotency = "required" as const;
  ingestAttemptCount = 0;
  readonly #events: SellerResponseEvent[] = [];
  readonly #idempotency = new Map<string, string>();

  get events(): readonly SellerResponseEvent[] {
    return Object.freeze([...this.#events]);
  }

  ingest(
    event: SellerResponseEvent,
  ): Readonly<{ accepted: true; replayed: boolean }> {
    this.ingestAttemptCount += 1;
    const key = event.idempotencyKey;
    const fingerprint = stableFingerprint(event);
    const existing = this.#idempotency.get(key);
    if (existing) {
      if (existing !== fingerprint) throw new IdempotencyConflictError();
      return Object.freeze({ accepted: true, replayed: true });
    }

    this.#idempotency.set(key, fingerprint);
    this.#events.push(event);
    return Object.freeze({ accepted: true, replayed: false });
  }
}

class SellerResponseControlLoop {
  readonly #provider: SimulatorBackedSellerCommunicationProvider;
  readonly #sink: OrbitEventSink<SellerResponseEvent>;
  readonly #cases = new Map<string, MutableSellerResponseCase>();
  readonly #audit = new Map<string, SellerResponseAuditEvidence[]>();
  readonly #commands = new Map<
    string,
    { fingerprint: string; result: CommandResult }
  >();
  readonly #commandLocks = new Map<string, Promise<void>>();
  readonly #caseLocks = new Map<string, Promise<void>>();

  constructor(
    provider: SimulatorBackedSellerCommunicationProvider,
    sink: SellerResponseEventSink,
  ) {
    this.#provider = provider;
    this.#sink = sink;
  }

  async requestSellerResponse(input: RequestInput): Promise<RequestResult> {
    const normalized = {
      caseId: caseId(input?.caseId),
      orderId: requiredText(input?.orderId, "orderId"),
      sellerId: requiredText(input?.sellerId, "sellerId"),
      requestTemplate: input?.requestTemplate,
      idempotencyKey: requiredText(input?.idempotencyKey, "idempotencyKey"),
      requestedAt: isoTime(input?.requestedAt, "requestedAt"),
      timeoutAt: isoTime(input?.timeoutAt, "timeoutAt"),
    };
    if (normalized.requestTemplate !== SELLER_REQUEST_TEMPLATE) {
      throw new TypeError("requestTemplate is not approved for v1");
    }
    if (normalized.timeoutAt <= normalized.requestedAt) {
      throw new RangeError("timeoutAt must be after requestedAt");
    }

    const fingerprint = stableFingerprint({
      command: "request",
      ...normalized,
    });
    return this.#serializeCommand(normalized.idempotencyKey, () =>
      this.#serializeCase(normalized.caseId, async () => {
        const replay = this.#readReplay<RequestResult>(
          normalized.idempotencyKey,
          fingerprint,
        );
        if (replay) return replay;
        if (this.#cases.has(normalized.caseId)) {
          throw new SellerResponseCaseStateError(
            "The seller response case already exists",
          );
        }

        const receipt = await this.#provider.sendRequest({
          caseId: normalized.caseId,
          sellerId: normalized.sellerId,
          requestTemplate: SELLER_REQUEST_TEMPLATE,
          idempotencyKey: normalized.idempotencyKey,
        });
        const event = immutableEvent({
          type: SELLER_REQUEST_SENT_EVENT,
          caseId: normalized.caseId,
          orderId: normalized.orderId,
          occurredAt: normalized.requestedAt,
          idempotencyKey: normalized.idempotencyKey,
          payload: {
            sellerId: normalized.sellerId,
            requestTemplate: SELLER_REQUEST_TEMPLATE,
            timeoutAt: normalized.timeoutAt,
            provider: receipt.provider,
            providerRequestId: receipt.providerRequestId,
          },
        });
        await this.#sink.ingest(event);

        this.#cases.set(normalized.caseId, {
          caseId: normalized.caseId,
          orderId: normalized.orderId,
          sellerId: normalized.sellerId,
          requestTemplate: SELLER_REQUEST_TEMPLATE,
          requestedAt: normalized.requestedAt,
          timeoutAt: normalized.timeoutAt,
          status: "awaiting_seller",
          response: null,
          respondedAt: null,
          fallback: null,
          providerRequestId: receipt.providerRequestId,
          fallbackReference: null,
        });
        this.#appendAudit(event, {
          provider: receipt.provider,
          providerRequestId: receipt.providerRequestId,
          externalMessageSent: false,
        });
        const result = Object.freeze({
          caseId: normalized.caseId,
          outcome: "request_sent" as const,
          providerRequestId: receipt.providerRequestId,
          replayed: false,
        });
        this.#remember(normalized.idempotencyKey, fingerprint, result);
        return result;
      }),
    );
  }

  async recordSellerResponse(input: ResponseInput): Promise<ResponseResult> {
    const normalized = {
      caseId: caseId(input?.caseId),
      response: input?.response,
      idempotencyKey: requiredText(input?.idempotencyKey, "idempotencyKey"),
      respondedAt: isoTime(input?.respondedAt, "respondedAt"),
    };
    if (
      normalized.response !== "accepted" &&
      normalized.response !== "declined"
    ) {
      throw new TypeError("response must be accepted or declined");
    }

    const fingerprint = stableFingerprint({
      command: "respond",
      ...normalized,
    });
    return this.#serializeCommand(normalized.idempotencyKey, () =>
      this.#serializeCase(normalized.caseId, async () => {
        const replay = this.#readReplay<ResponseResult>(
          normalized.idempotencyKey,
          fingerprint,
        );
        if (replay) return replay;
        const current = this.#requiredCase(normalized.caseId);
        if (current.status !== "awaiting_seller") {
          throw new SellerResponseCaseStateError(
            "The seller response case is already resolved",
          );
        }
        if (
          normalized.respondedAt < current.requestedAt ||
          normalized.respondedAt >= current.timeoutAt
        ) {
          throw new SellerResponseCaseStateError(
            "The seller response is outside the active response window",
          );
        }

        const event = immutableEvent({
          type: SELLER_RESPONDED_EVENT,
          caseId: current.caseId,
          orderId: current.orderId,
          occurredAt: normalized.respondedAt,
          idempotencyKey: normalized.idempotencyKey,
          payload: {
            response: normalized.response,
            provider: "simulator",
          },
        });
        await this.#sink.ingest(event);
        current.status = "seller_responded";
        current.response = normalized.response;
        current.respondedAt = normalized.respondedAt;
        this.#appendAudit(event, {
          provider: "simulator",
          response: normalized.response,
          externalMessageSent: false,
        });
        const result = Object.freeze({
          caseId: current.caseId,
          outcome: "seller_responded" as const,
          replayed: false,
        });
        this.#remember(normalized.idempotencyKey, fingerprint, result);
        return result;
      }),
    );
  }

  async processSellerResponseTimeout(
    input: TimeoutInput,
  ): Promise<TimeoutResult> {
    const normalized = {
      caseId: caseId(input?.caseId),
      idempotencyKey: requiredText(input?.idempotencyKey, "idempotencyKey"),
      observedAt: isoTime(input?.observedAt, "observedAt"),
    };
    const fingerprint = stableFingerprint({
      command: "timeout",
      ...normalized,
    });

    return this.#serializeCommand(normalized.idempotencyKey, () =>
      this.#serializeCase(normalized.caseId, async () => {
        const replay = this.#readReplay<TimeoutResult>(
          normalized.idempotencyKey,
          fingerprint,
        );
        if (replay) return replay;
        const current = this.#requiredCase(normalized.caseId);
        if (current.status !== "awaiting_seller") {
          const result = Object.freeze({
            caseId: current.caseId,
            outcome: "already_resolved" as const,
            replayed: false,
          });
          this.#remember(normalized.idempotencyKey, fingerprint, result);
          return result;
        }
        if (normalized.observedAt < current.timeoutAt) {
          const result = Object.freeze({
            caseId: current.caseId,
            outcome: "not_due" as const,
            replayed: false,
          });
          this.#remember(normalized.idempotencyKey, fingerprint, result);
          return result;
        }

        const receipt = await this.#provider.queueManualFallback({
          caseId: current.caseId,
          reason: "seller_response_timeout",
          idempotencyKey: normalized.idempotencyKey,
        });
        const event = immutableEvent({
          type: SELLER_REQUEST_MISSED_EVENT,
          caseId: current.caseId,
          orderId: current.orderId,
          occurredAt: normalized.observedAt,
          idempotencyKey: normalized.idempotencyKey,
          payload: {
            fallback: receipt.fallback,
            fallbackReference: receipt.fallbackReference,
            provider: receipt.provider,
            reason: "seller_response_timeout",
          },
        });
        await this.#sink.ingest(event);
        current.status = "fallback_queued";
        current.fallback = receipt.fallback;
        current.fallbackReference = receipt.fallbackReference;
        this.#appendAudit(event, {
          provider: receipt.provider,
          fallback: receipt.fallback,
          fallbackReference: receipt.fallbackReference,
          externalMessageSent: false,
          rankingPenaltyApplied: false,
          paymentMutationApplied: false,
        });
        const result = Object.freeze({
          caseId: current.caseId,
          outcome: "fallback_queued" as const,
          replayed: false,
        });
        this.#remember(normalized.idempotencyKey, fingerprint, result);
        return result;
      }),
    );
  }

  getCase(id: string): SellerResponseCaseSnapshot | null {
    const current = this.#cases.get(caseId(id));
    if (!current) return null;
    return Object.freeze({
      ...current,
      orchestrator: ATLAS_ORCHESTRATOR,
      caseAgent: ORDERGUARD_CASE_AGENT,
      communicationAgent: SHOPKEEPER_COMMUNICATION_AGENT,
    });
  }

  getAuditEvidence(id: string): readonly SellerResponseAuditEvidence[] {
    const entries = this.#audit.get(caseId(id)) ?? [];
    return Object.freeze([...entries]);
  }

  getSimulatorMetrics(): SellerResponseSimulatorMetrics {
    if (!(this.#provider instanceof SimulatorSellerCommunicationProvider)) {
      throw new TypeError(
        "The v1 control loop requires its built-in simulator",
      );
    }
    return Object.freeze({
      mode: this.#provider.mode,
      requestAttemptCount: this.#provider.requestAttemptCount,
      requestWorkCount: this.#provider.requestWorkCount,
      fallbackAttemptCount: this.#provider.fallbackAttemptCount,
      fallbackWorkCount: this.#provider.fallbackWorkCount,
    });
  }

  #requiredCase(id: string): MutableSellerResponseCase {
    const current = this.#cases.get(id);
    if (!current)
      throw new SellerResponseCaseStateError("Seller response case not found");
    return current;
  }

  #readReplay<T extends CommandResult>(
    idempotencyKey: string,
    fingerprint: string,
  ): T | null {
    const existing = this.#commands.get(idempotencyKey);
    if (!existing) return null;
    if (existing.fingerprint !== fingerprint)
      throw new IdempotencyConflictError();
    return replayResult(existing.result as T);
  }

  #remember(
    idempotencyKey: string,
    fingerprint: string,
    result: CommandResult,
  ): void {
    this.#commands.set(idempotencyKey, { fingerprint, result });
  }

  #appendAudit(
    event: SellerResponseEvent,
    evidence: Record<string, string | boolean | null>,
  ): void {
    const entries = this.#audit.get(event.subject.caseId) ?? [];
    const entry = Object.freeze({
      auditId: `${event.subject.caseId}:audit:${entries.length + 1}`,
      caseId: event.subject.caseId,
      action: event.type,
      occurredAt: event.occurredAt,
      idempotencyKey: event.idempotencyKey,
      orchestrator: ATLAS_ORCHESTRATOR,
      caseAgent: ORDERGUARD_CASE_AGENT,
      communicationAgent: SHOPKEEPER_COMMUNICATION_AGENT,
      evidence: Object.freeze({ ...evidence }),
    });
    entries.push(entry);
    this.#audit.set(event.subject.caseId, entries);
  }

  #serializeCommand<T>(
    idempotencyKey: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.#serialize(this.#commandLocks, idempotencyKey, work);
  }

  #serializeCase<T>(
    caseIdentifier: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.#serialize(this.#caseLocks, caseIdentifier, work);
  }

  async #serialize<T>(
    locks: Map<string, Promise<void>>,
    identifier: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = locks.get(identifier) ?? Promise.resolve();
    let release: () => void = () => void 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    locks.set(identifier, tail);
    await previous;

    try {
      return await work();
    } finally {
      release();
      if (locks.get(identifier) === tail) {
        locks.delete(identifier);
      }
    }
  }
}

export function createSellerResponseControlLoop(input: {
  sink: SellerResponseEventSink;
}): SellerResponseControlLoop {
  if (input && "provider" in input) {
    throw new TypeError(
      "Provider injection is disabled; v1 always uses the built-in simulator",
    );
  }
  if (
    !input.sink ||
    input.sink.idempotency !== "required" ||
    typeof input.sink.ingest !== "function"
  ) {
    throw new TypeError("An idempotent ORBIT event sink is required");
  }
  return new SellerResponseControlLoop(
    new SimulatorSellerCommunicationProvider(),
    input.sink,
  );
}
