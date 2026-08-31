import {
  platformSummaryRequestSchema,
  platformSummaryResultSchema,
  TOOL_GATEWAY_CONTRACT_VERSION,
  type PlatformSummaryData,
  type PlatformSummaryResult,
} from "@/lib/tools/contract";
import { EXECUTABLE_TOOL_REGISTRY } from "@/lib/tools/registry";

export type ToolGatewayControlEvent = Readonly<{
  invocationId: string;
  tool: "get_platform_summary" | null;
  outcome:
    | "invalid_request"
    | "authorization_failed"
    | "dependency_failed"
    | "timeout"
    | "cancelled";
}>;

export type ToolGatewayAdapter = {
  getPlatformSummary(input: {
    invocationId: string;
    marketSlug: string;
    signal: AbortSignal;
  }): Promise<PlatformSummaryResult | null>;
};

export type ToolGatewayDependencies = {
  authorize(): Promise<boolean>;
  adapter: ToolGatewayAdapter;
  observe(event: ToolGatewayControlEvent): void;
  randomUUID?: () => string;
};

export type ToolGatewayEnvelope =
  | {
      ok: true;
      contractVersion: 1;
      invocationId: string;
      tool: "get_platform_summary";
      actionClass: "green";
      auditEventId: string;
      observedAt: string;
      data: PlatformSummaryData;
    }
  | {
      ok: false;
      contractVersion: 1;
      invocationId: string;
      tool: "get_platform_summary" | null;
      error:
        | {
            code: "invalid_request";
            retryable: false;
            auditEventId?: string;
          }
        | { code: "authorization_failed"; retryable: false }
        | { code: "unavailable"; retryable: boolean; auditEventId?: string }
        | {
            code: "rate_limited";
            retryable: true;
            auditEventId: string | null;
          }
        | { code: "timeout" | "cancelled"; retryable: true };
    };

const TIMEOUT = Symbol("tool-gateway-timeout");
const CANCELLED = Symbol("tool-gateway-cancelled");

async function executeOnceWithDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<T> {
  if (callerSignal?.aborted) throw CANCELLED;

  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let callerAbortHandle: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(TIMEOUT);
    }, timeoutMs);
  });
  const callerAbort = new Promise<never>((_resolve, reject) => {
    if (!callerSignal) return;
    callerAbortHandle = () => reject(CANCELLED);
    callerSignal.addEventListener("abort", callerAbortHandle, { once: true });
  });

  try {
    return await Promise.race([
      operation(controller.signal),
      timeout,
      callerAbort,
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    callerSignal?.removeEventListener("abort", onCallerAbort);
    if (callerAbortHandle) {
      callerSignal?.removeEventListener("abort", callerAbortHandle);
    }
  }
}

function rejectedEnvelope(
  invocationId: string,
  tool: "get_platform_summary" | null,
  error: Extract<ToolGatewayEnvelope, { ok: false }>["error"],
): ToolGatewayEnvelope {
  return {
    ok: false,
    contractVersion: TOOL_GATEWAY_CONTRACT_VERSION,
    invocationId,
    tool,
    error,
  };
}

export async function dispatchToolGatewayRequest(
  value: unknown,
  dependencies: ToolGatewayDependencies,
  options: { signal?: AbortSignal } = {},
): Promise<ToolGatewayEnvelope> {
  const invocationId = (dependencies.randomUUID ?? crypto.randomUUID)();
  const request = platformSummaryRequestSchema.safeParse(value);
  if (!request.success) {
    dependencies.observe({
      invocationId,
      tool: null,
      outcome: "invalid_request",
    });
    return rejectedEnvelope(invocationId, null, {
      code: "invalid_request",
      retryable: false,
    });
  }

  const definition = EXECUTABLE_TOOL_REGISTRY.get(request.data.tool);
  if (!definition) {
    dependencies.observe({
      invocationId,
      tool: null,
      outcome: "invalid_request",
    });
    return rejectedEnvelope(invocationId, null, {
      code: "invalid_request",
      retryable: false,
    });
  }

  let authorized = false;
  try {
    authorized = await dependencies.authorize();
  } catch {
    dependencies.observe({
      invocationId,
      tool: request.data.tool,
      outcome: "dependency_failed",
    });
    return rejectedEnvelope(invocationId, request.data.tool, {
      code: "unavailable",
      retryable: true,
    });
  }
  if (!authorized) {
    dependencies.observe({
      invocationId,
      tool: request.data.tool,
      outcome: "authorization_failed",
    });
    return rejectedEnvelope(invocationId, request.data.tool, {
      code: "authorization_failed",
      retryable: false,
    });
  }

  let rawResult: PlatformSummaryResult | null;
  try {
    rawResult = await executeOnceWithDeadline(
      (signal) =>
        dependencies.adapter.getPlatformSummary({
          invocationId,
          marketSlug: request.data.input.marketSlug,
          signal,
        }),
      definition.timeoutMs,
      options.signal,
    );
  } catch (error) {
    const outcome =
      error === TIMEOUT
        ? "timeout"
        : error === CANCELLED
          ? "cancelled"
          : "dependency_failed";
    dependencies.observe({
      invocationId,
      tool: request.data.tool,
      outcome,
    });
    if (outcome === "timeout" || outcome === "cancelled") {
      return rejectedEnvelope(invocationId, request.data.tool, {
        code: outcome,
        retryable: true,
      });
    }
    return rejectedEnvelope(invocationId, request.data.tool, {
      code: "unavailable",
      retryable: true,
    });
  }

  const result = platformSummaryResultSchema.safeParse(rawResult);
  if (!result.success || result.data.invocationId !== invocationId) {
    dependencies.observe({
      invocationId,
      tool: request.data.tool,
      outcome: "dependency_failed",
    });
    return rejectedEnvelope(invocationId, request.data.tool, {
      code: "unavailable",
      retryable: true,
    });
  }

  if (result.data.outcome === "succeeded") {
    return {
      ok: true,
      contractVersion: TOOL_GATEWAY_CONTRACT_VERSION,
      invocationId,
      tool: request.data.tool,
      actionClass: definition.actionClass,
      auditEventId: result.data.auditEventId,
      observedAt: result.data.observedAt,
      data: result.data.data,
    };
  }
  if (result.data.outcome === "rate_limited") {
    return rejectedEnvelope(invocationId, request.data.tool, {
      code: "rate_limited",
      retryable: true,
      auditEventId: result.data.auditEventId,
    });
  }
  if (result.data.outcome === "invalid_input") {
    return rejectedEnvelope(invocationId, request.data.tool, {
      code: "invalid_request",
      retryable: false,
      auditEventId: result.data.auditEventId,
    });
  }
  return rejectedEnvelope(invocationId, request.data.tool, {
    code: "unavailable",
    retryable: false,
    auditEventId: result.data.auditEventId,
  });
}
