import { describe, expect, it } from "vitest";

import {
  buildExecutableToolRegistry,
  EXECUTABLE_TOOL_REGISTRY,
  PROHIBITED_TOOL_CAPABILITIES,
  TOOL_GATEWAY_REGISTRY,
} from "@/lib/tools/registry";

describe("tool-gateway registry", () => {
  it("describes every directive tool while exposing only the audited first slice", () => {
    expect(TOOL_GATEWAY_REGISTRY.map((tool) => tool.name)).toEqual([
      "get_platform_summary",
      "get_revenue_report",
      "get_order",
      "get_order_issues",
      "get_vendor",
      "get_vendor_status",
      "get_demand_gaps",
      "get_search_trends",
      "get_unmet_demand",
      "create_referral_mission",
      "contact_customer",
      "contact_vendor",
      "generate_campaign",
      "publish_campaign",
      "get_campaign_performance",
      "recommend_growth_actions",
      "get_system_health",
      "get_incidents",
    ]);
    expect(
      TOOL_GATEWAY_REGISTRY.filter((tool) => tool.status === "implemented"),
    ).toEqual([
      expect.objectContaining({
        name: "get_platform_summary",
        actionClass: "green",
        scope: "platform.summary.read",
        domainReadOnly: true,
        externalEffect: false,
      }),
    ]);
    expect([...EXECUTABLE_TOOL_REGISTRY.keys()]).toEqual([
      "get_platform_summary",
    ]);
  });

  it("requires approval for side effects and exposes no RED capability", () => {
    for (const name of [
      "create_referral_mission",
      "contact_customer",
      "contact_vendor",
      "publish_campaign",
    ]) {
      expect(TOOL_GATEWAY_REGISTRY.find((tool) => tool.name === name)).toEqual(
        expect.objectContaining({
          actionClass: "yellow",
          status: "prohibited",
        }),
      );
    }
    expect(
      TOOL_GATEWAY_REGISTRY.map((tool) => String(tool.actionClass)),
    ).not.toContain("red");
    expect(PROHIBITED_TOOL_CAPABILITIES).toEqual([
      "credential_access",
      "record_deletion",
      "money_transfer",
      "irreversible_infrastructure_mutation",
      "security_control_mutation",
    ]);
  });

  it("rejects duplicate executable names and wildcard authority", () => {
    const definition = EXECUTABLE_TOOL_REGISTRY.get("get_platform_summary");
    expect(definition).toBeDefined();
    if (!definition) throw new Error("Expected executable tool definition.");
    expect(() =>
      buildExecutableToolRegistry([definition!, definition!]),
    ).toThrow("Invalid executable tool definition.");
    expect(() =>
      buildExecutableToolRegistry([
        { ...definition, scope: "platform.*" } as unknown as typeof definition,
      ]),
    ).toThrow("Invalid executable tool definition.");
  });
});
