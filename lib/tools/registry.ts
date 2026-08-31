import type { ZodType } from "zod";

import {
  platformSummaryDataSchema,
  platformSummaryRequestSchema,
  TOOL_GATEWAY_CONTRACT_VERSION,
} from "@/lib/tools/contract";

export type ToolActionClass = "green" | "yellow";
export type ToolStatus = "implemented" | "deferred" | "prohibited";

export type ToolCatalogueEntry = Readonly<{
  name: string;
  actionClass: ToolActionClass;
  status: ToolStatus;
  scope: string;
  domainReadOnly: boolean;
  externalEffect: boolean;
}>;

export type ExecutableToolDefinition = Readonly<{
  name: "get_platform_summary";
  contractVersion: 1;
  scope: "platform.summary.read";
  actionClass: "green";
  riskLevel: "R2";
  approval: "A0";
  timeoutMs: 5_000;
  requestSchema: ZodType;
  outputSchema: ZodType;
}>;

export function buildExecutableToolRegistry(
  definitions: readonly ExecutableToolDefinition[],
): ReadonlyMap<string, ExecutableToolDefinition> {
  const registry = new Map<string, ExecutableToolDefinition>();
  for (const definition of definitions) {
    if (
      !/^[a-z][a-z0-9_]{1,62}$/.test(definition.name) ||
      !/^[a-z][a-z0-9_.]{1,62}$/.test(definition.scope) ||
      definition.name.includes("*") ||
      definition.scope.includes("*") ||
      registry.has(definition.name)
    ) {
      throw new Error("Invalid executable tool definition.");
    }
    registry.set(definition.name, Object.freeze(definition));
  }
  return registry;
}

const platformSummaryDefinition: ExecutableToolDefinition = Object.freeze({
  name: "get_platform_summary",
  contractVersion: TOOL_GATEWAY_CONTRACT_VERSION,
  scope: "platform.summary.read",
  actionClass: "green",
  riskLevel: "R2",
  approval: "A0",
  timeoutMs: 5_000,
  requestSchema: platformSummaryRequestSchema,
  outputSchema: platformSummaryDataSchema,
});

export const EXECUTABLE_TOOL_REGISTRY = buildExecutableToolRegistry([
  platformSummaryDefinition,
]);

export const TOOL_GATEWAY_REGISTRY: readonly ToolCatalogueEntry[] =
  Object.freeze([
    {
      name: "get_platform_summary",
      actionClass: "green",
      status: "implemented",
      scope: "platform.summary.read",
      domainReadOnly: true,
      externalEffect: false,
    },
    {
      name: "get_revenue_report",
      actionClass: "green",
      status: "prohibited",
      scope: "unavailable",
      domainReadOnly: true,
      externalEffect: false,
    },
    ...[
      "get_order",
      "get_order_issues",
      "get_vendor",
      "get_vendor_status",
      "get_demand_gaps",
      "get_search_trends",
      "get_unmet_demand",
    ].map((name) => ({
      name,
      actionClass: "green" as const,
      status: "deferred" as const,
      scope: "unavailable",
      domainReadOnly: true,
      externalEffect: false,
    })),
    ...["create_referral_mission", "contact_customer", "contact_vendor"].map(
      (name) => ({
        name,
        actionClass: "yellow" as const,
        status: "prohibited" as const,
        scope: "unavailable",
        domainReadOnly: false,
        externalEffect: name !== "create_referral_mission",
      }),
    ),
    {
      name: "generate_campaign",
      actionClass: "green",
      status: "prohibited",
      scope: "unavailable",
      domainReadOnly: true,
      externalEffect: false,
    },
    {
      name: "publish_campaign",
      actionClass: "yellow",
      status: "prohibited",
      scope: "unavailable",
      domainReadOnly: false,
      externalEffect: true,
    },
    ...[
      "get_campaign_performance",
      "recommend_growth_actions",
      "get_system_health",
      "get_incidents",
    ].map((name) => ({
      name,
      actionClass: "green" as const,
      status: "deferred" as const,
      scope: "unavailable",
      domainReadOnly: true,
      externalEffect: false,
    })),
  ]);

export const PROHIBITED_TOOL_CAPABILITIES = Object.freeze([
  "credential_access",
  "record_deletion",
  "money_transfer",
  "irreversible_infrastructure_mutation",
  "security_control_mutation",
] as const);
