import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parsePlatformSummaryRpcResult,
  type PlatformSummaryResult,
} from "@/lib/tools/contract";
import type { ToolGatewayAdapter } from "@/lib/tools/dispatcher";
import type { Database } from "@/lib/supabase/database.types";

type ToolGatewayUserClient = Pick<SupabaseClient<Database>, "rpc">;

export function createSupabaseToolGatewayAdapter(
  client: ToolGatewayUserClient,
): ToolGatewayAdapter {
  return {
    async getPlatformSummary(input): Promise<PlatformSummaryResult | null> {
      const result = await client
        .rpc("get_tool_gateway_platform_summary", {
          p_invocation_id: input.invocationId,
          p_market_slug: input.marketSlug,
        })
        .abortSignal(input.signal);
      if (result.error) return null;
      return parsePlatformSummaryRpcResult(result.data, {
        invocationId: input.invocationId,
        marketSlug: input.marketSlug,
      });
    },
  };
}
