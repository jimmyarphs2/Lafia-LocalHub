npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
import {
  AgentRunRegistry,
  DecisionEngine,
  EventEngine,
  InMemoryStore,
  MemoryKernel,
  MutationGuard,
  OrbitRuntime,
  sha256,
} from "@jimmyarphs2/orbit-os-core";

import {
  LOCALHUB_ORBIT_COMPANY_ID,
  MERCHANT_ONBOARDING_STALLED_EVENT,
  toMerchantOnboardingStalledEvent,
} from "./localhub-bridge";
import type {
  LocalHubOrbitEvent,
  MerchantOnboardingStalledInput,
} from "./localhub-bridge";

const MEMORY_PURPOSE = "localhub.merchant.onboarding";
const FOLLOWUP_DRAFT_ACTION = "localhub.merchant.followup_draft.create";
const FOLLOWUP_THRESHOLD_HOURS = 24;
const EXECUTION_CONTRACT = Object.freeze({
  purpose: "localhub.merchant.onboarding.followup",
  permissions: [FOLLOWUP_DRAFT_ACTION],
  maxDurationMs: 30_000,
  maxRetries: 0,
});

type StoredEvent = LocalHubOrbitEvent & {
  id: string;
  receivedAt: string;
  evidenceHash: string;
};

type StoredDecision = {
  id: string;
  companyId: string;
  eventId: string;
  status: string;
  action: {
    type: string;
    resource: string;
    recipient?: string | null;
    payload?: Record<string, unknown>;
  } | null;
  risk: string;
  rationale: string;
};

type StoredRun = {
  id: string;
  companyId: string;
  eventId: string | null;
  status: string;
  result: Record<string, unknown> | null;
};

type StoredExecution = {
  duplicate: boolean;
  result: Record<string, unknown>;
};

type LocalHubError = Error & {
  code: string;
  details: Record<string, unknown>;
};

function localHubError(code: string, message: string): LocalHubError {
  const error = new Error(message) as LocalHubError;
  error.name = "OrbitError";
  error.code = code;
  error.details = {};
  return error;
}

type AuditEntry = {
  companyId: string;
  kind: string;
  subjectId: string;
  at: string;
  details?: Record<string, unknown>;
};

type GovernedStore = InMemoryStore & {
  events: Map<string, StoredEvent>;
  evidence: Map<string, Record<string, unknown>>;
  memories: Map<string, Record<string, unknown>>;
  decisions: Map<string, StoredDecision>;
  runs: Map<string, StoredRun>;
  approvals: Map<string, Record<string, unknown>>;
  idempotency: Map<string, Record<string, unknown>>;
  audit: AuditEntry[];
  appendAudit(entry: AuditEntry): void;
};

export type GovernedWorkflowResult = {
  event: StoredEvent;
  duplicate: boolean;
  run: StoredRun;
  decision: StoredDecision;
  execution: StoredExecution | null;
  memory: Record<string, unknown> | null;
};

export type ApprovedFollowupResult = {
  event: StoredEvent;
  decision: StoredDecision;
  approval: Record<string, unknown> | null;
  run: StoredRun;
  execution: StoredExecution;
};

function onboardingPolicy() {
  return {
    companyId: LOCALHUB_ORBIT_COMPANY_ID,
    eventType: MERCHANT_ONBOARDING_STALLED_EVENT,
    version: "1.0.0",
    enabled: false,
    allowedActions: [FOLLOWUP_DRAFT_ACTION],
    evaluate({
      event,
    }: {
      event: Record<string, unknown>;
      context: unknown[];
    }) {
      const payload = event.payload as {
        hoursStalled?: number;
        recipient?: string | null;
        nextStep?: string;
      };
      const merchantId = (event.subject as { aggregateId: string }).aggregateId;
      const hoursStalled = payload.hoursStalled ?? 0;

      if (hoursStalled < FOLLOWUP_THRESHOLD_HOURS) {
        return {
          risk: "low" as const,
          rationale: "The merchant has not crossed the follow-up threshold.",
          action: null,
        };
      }

      return {
        risk: "medium" as const,
        rationale:
          "Prepare a follow-up draft for founder approval; autonomous sending is disabled.",
        action: {
          type: FOLLOWUP_DRAFT_ACTION,
          resource: `merchant:${merchantId}`,
          recipient: payload.recipient ?? null,
          payload: {
            merchantId,
            hoursStalled,
            nextStep: payload.nextStep ?? "",
            channel: "email",
            delivery: "draft_only",
          },
        },
      };
    },
  };
}

function resultOf(value: Record<string, unknown>): GovernedWorkflowResult {
  return value as unknown as GovernedWorkflowResult;
}

function eventFromStore(store: GovernedStore, eventId: string): StoredEvent {
  const event = store.events.get(eventId);
  if (!event) {
    throw localHubError(
      "LOCALHUB_EVENT_NOT_FOUND",
      "The LocalHub event was not found.",
    );
  }
  return event;
}

function decisionForEvent(
  store: GovernedStore,
  eventId: string,
): StoredDecision {
  const decision = [...store.decisions.values()].find(
    (candidate) => candidate.eventId === eventId,
  );
  if (!decision) {
    throw localHubError(
      "LOCALHUB_DECISION_NOT_FOUND",
      "No ORBIT decision is recorded for the LocalHub event.",
    );
  }
  return decision;
}

function runForEvent(store: GovernedStore, eventId: string): StoredRun {
  const run = [...store.runs.values()].find(
    (candidate) => candidate.eventId === eventId,
  );
  if (!run) {
    throw localHubError(
      "LOCALHUB_RUN_NOT_FOUND",
      "No ORBIT runtime run is recorded for the LocalHub event.",
    );
  }
  return run;
}

function persistOnboardingMemory(
  memory: MemoryKernel,
  store: GovernedStore,
  event: StoredEvent,
): Record<string, unknown> {
  const evidence = memory.preserveEvidence({
    companyId: event.companyId,
    sourceType: "localhub.merchant.onboarding",
    sourceRef: event.source.eventId,
    observedAt: event.occurredAt,
    classification: "internal",
    content: {
      merchantId: event.subject.aggregateId,
      type: event.type,
      payload: event.payload,
    },
  }) as Record<string, unknown>;

  const memoryRecord = memory.admit({
    companyId: event.companyId,
    kind: "current_state",
    key: `merchant:${event.subject.aggregateId}:onboarding`,
    purpose: MEMORY_PURPOSE,
    value: {
      merchantId: event.subject.aggregateId,
      status: "stalled",
      hoursStalled: event.payload.hoursStalled,
      nextStep: event.payload.nextStep,
      recipient: event.payload.recipient,
    },
    confidence: 1,
    evidenceIds: [evidence.id],
    policyVersion: "1.0.0",
  }) as Record<string, unknown>;

  store.appendAudit({
    companyId: event.companyId,
    kind: "localhub.onboarding.memory_recorded",
    subjectId: event.id,
    at: new Date().toISOString(),
    details: {
      memoryId: memoryRecord.id,
      evidenceId: evidence.id,
      purpose: MEMORY_PURPOSE,
    },
  });

  return memoryRecord;
}

/**
 * Creates the first LocalHub workflow running through ORBIT's governed
 * runtime. It prepares an internal follow-up draft only; it never sends a
 * customer message.
 */
export function createLocalHubGovernedRuntime() {
  const store = new InMemoryStore() as GovernedStore;
  const events = new EventEngine({ store });
  const memory = new MemoryKernel({ store });
  const decisions = new DecisionEngine({
    store,
    policies: [onboardingPolicy()],
  });
  const runs = new AgentRunRegistry({ store });
  const mutations = new MutationGuard({ store });
  const runtime = new OrbitRuntime({
    events,
    memory,
    decisions,
    runs,
    mutations,
  });

  return Object.freeze({
    store,

    async processMerchantOnboardingStalled(
      input: MerchantOnboardingStalledInput,
    ): Promise<GovernedWorkflowResult> {
      const processed = resultOf(
        await runtime.process({
          event: toMerchantOnboardingStalledEvent(input),
          workflow: "localhub.merchant.onboarding_followup",
          memoryPurpose: MEMORY_PURPOSE,
          executionContract: EXECUTION_CONTRACT,
          model: {
            provider: "orbit",
            name: "governed-runtime",
          },
          skillVersions: {
            "localhub.onboarding": "1.0.0",
          },
          authorize: async () => {
            throw localHubError(
              "LOCALHUB_AUTONOMOUS_ACTION_DISABLED",
              "LocalHub customer actions require explicit founder approval.",
            );
          },
          execute: async () => {
            throw localHubError(
              "LOCALHUB_AUTONOMOUS_ACTION_DISABLED",
              "Outbound LocalHub actions are disabled in this pilot.",
            );
          },
        }),
      );

      const memoryRecord = processed.duplicate
        ? null
        : persistOnboardingMemory(memory, store, processed.event);

      return {
        ...processed,
        memory: memoryRecord,
      };
    },

    async approveMerchantOnboardingFollowup({
      eventId,
      approvedBy,
    }: {
      eventId: string;
      approvedBy: string;
    }): Promise<ApprovedFollowupResult> {
      const event = eventFromStore(store, eventId);
      const decision = decisionForEvent(store, eventId);
      const run = runForEvent(store, eventId);

      if (run.status === "succeeded" && run.result) {
        return {
          event,
          decision,
          approval: null,
          run,
          execution: {
            duplicate: true,
            result: run.result,
          },
        };
      }

      if (run.status !== "waiting_approval") {
        throw localHubError(
          "LOCALHUB_APPROVAL_NOT_PENDING",
          "This LocalHub workflow is not waiting for founder approval.",
        );
      }
      if (
        decision.status !== "founder_review_required" ||
        !decision.action ||
        decision.action.type !== FOLLOWUP_DRAFT_ACTION
      ) {
        throw localHubError(
          "LOCALHUB_ACTION_NOT_APPROVABLE",
          "Only the governed follow-up draft action can be approved.",
        );
      }

      const payload = structuredClone(decision.action.payload ?? {});
      const mutation = Object.freeze({
        companyId: event.companyId,
        actorId: "jarvis",
        action: decision.action.type,
        resource: decision.action.resource,
        recipient: decision.action.recipient ?? null,
        payload,
        contentHash: sha256(payload),
      });

      const approval = mutations.grant({
        companyId: event.companyId,
        approvedBy,
        mutation,
        singleUse: true,
      }) as Record<string, unknown>;

      store.appendAudit({
        companyId: event.companyId,
        kind: "approval.granted",
        subjectId: String(approval.id),
        at: new Date().toISOString(),
        details: {
          eventId,
          decisionId: decision.id,
          mutationAction: mutation.action,
          mutationResource: mutation.resource,
        },
      });

      const executing = runs.transition({
        companyId: event.companyId,
        runId: run.id,
        status: "running",
        nextAction: "execute_approved_draft",
      }) as StoredRun;

      try {
        const execution = (await mutations.execute({
          approvalId: approval.id,
          mutation,
          idempotencyKey: JSON.stringify([
            event.id,
            mutation.action,
            mutation.resource,
          ]),
          executor: async (approvedMutation: Record<string, unknown>) => {
            const draft = {
              status: "drafted",
              delivery: "draft_only",
              merchantId: event.subject.aggregateId,
              recipient: approvedMutation.recipient ?? null,
              content: approvedMutation.payload,
            };
            store.appendAudit({
              companyId: event.companyId,
              kind: "localhub.followup.draft_created",
              subjectId: event.subject.aggregateId,
              at: new Date().toISOString(),
              details: {
                eventId,
                approvalId: approval.id,
              },
            });
            return draft;
          },
        })) as StoredExecution;

        const completed = runs.transition({
          companyId: event.companyId,
          runId: executing.id,
          status: "succeeded",
          result: execution.result,
        }) as StoredRun;

        return {
          event,
          decision,
          approval,
          run: completed,
          execution,
        };
      } catch (error) {
        runs.transition({
          companyId: event.companyId,
          runId: executing.id,
          status: "failed",
          failure: {
            code: error instanceof Error ? error.name : "UNEXPECTED_ERROR",
            message: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      }
    },
  });
}
