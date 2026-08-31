import type { SupabaseClient } from "@supabase/supabase-js";

import { parseUnmetDemandRecordResult } from "@/lib/demand/contract";
import type { Database } from "@/lib/supabase/database.types";

type DemandClient = Pick<SupabaseClient<Database>, "rpc">;

export async function recordMyUnmetDemandZeroResult(
  client: DemandClient,
  input: { marketSlug: string; categoryId: string },
): Promise<{ accepted: true } | null> {
  const result = await client.rpc("record_my_unmet_demand_zero_result", {
    p_market_slug: input.marketSlug,
    p_category_id: input.categoryId,
  });
  return parseUnmetDemandRecordResult(result.data, result.error);
}
