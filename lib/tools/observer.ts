import "server-only";

import type { ToolGatewayControlEvent } from "@/lib/tools/dispatcher";

export function observeToolGatewayControlEvent(
  event: ToolGatewayControlEvent,
): void {
  console.warn("[localhub-tool-gateway]", event);
}
