import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  dispatchToolGatewayRequest,
  type ToolGatewayAdapter,
  type ToolGatewayEnvelope,
} from "@/lib/tools/dispatcher";
import { observeToolGatewayControlEvent } from "@/lib/tools/observer";
import { createSupabaseToolGatewayAdapter } from "@/lib/tools/supabase-adapter";
import type { Database } from "@/lib/supabase/database.types";
import { getServerSupabaseClient } from "@/lib/supabase/server";

const unavailableAdapter: ToolGatewayAdapter = {
  async getPlatformSummary() {
    throw new Error("Tool adapter unavailable.");
  },
};

async function hasPlatformSummaryScope(
  client: SupabaseClient<Database>,
): Promise<boolean> {
  const userResult = await client.auth.getUser();
  if (userResult.error || !userResult.data.user) return false;

  const [activeResult, capabilityResult] = await Promise.all([
    client.rpc("is_current_profile_active"),
    client.rpc("has_capability", { required: "super_admin" }),
  ]);
  return (
    !activeResult.error &&
    !capabilityResult.error &&
    activeResult.data === true &&
    capabilityResult.data === true
  );
}

export async function invokeLocalHubTool(
  value: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<ToolGatewayEnvelope> {
  const client = await getServerSupabaseClient();
  return dispatchToolGatewayRequest(
    value,
    {
      authorize: () =>
        client ? hasPlatformSummaryScope(client) : Promise.resolve(false),
      adapter: client
        ? createSupabaseToolGatewayAdapter(client)
        : unavailableAdapter,
      observe: observeToolGatewayControlEvent,
    },
    options,
  );
}
