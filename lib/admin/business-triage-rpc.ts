import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parseActiveAdminMarkets,
  parseSuperAdminPendingBusinessPage,
  SUPER_ADMIN_BUSINESS_TRIAGE_PAGE_SIZE,
  type ActiveAdminMarket,
  type BusinessTriageCursor,
  type SuperAdminPendingBusinessPage,
} from "@/lib/admin/business-triage-contract";
import type { Database } from "@/lib/supabase/database.types";

type AdminUserClient = SupabaseClient<Database>;

function contractError() {
  return new Error("Admin triage response did not match its bounded contract.");
}

export async function getSuperAdminTriageAccess(
  client: AdminUserClient,
): Promise<{ allowed: boolean; error: unknown }> {
  const [activeResult, capabilityResult] = await Promise.all([
    client.rpc("is_current_profile_active"),
    client.rpc("has_capability", { required: "super_admin" }),
  ]);
  if (activeResult.error || capabilityResult.error) {
    return {
      allowed: false,
      error: activeResult.error ?? capabilityResult.error,
    };
  }
  if (
    typeof activeResult.data !== "boolean" ||
    typeof capabilityResult.data !== "boolean"
  ) {
    return { allowed: false, error: contractError() };
  }
  return {
    allowed: activeResult.data && capabilityResult.data,
    error: null,
  };
}

export async function listActiveAdminMarkets(
  client: AdminUserClient,
): Promise<{ markets: ActiveAdminMarket[]; error: unknown }> {
  const result = await client
    .from("markets")
    .select("id,slug,name")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(50);
  const markets = result.error ? null : parseActiveAdminMarkets(result.data);
  return {
    markets: markets ?? [],
    error: result.error ?? (markets ? null : contractError()),
  };
}

export async function listSuperAdminPendingBusinesses(
  client: AdminUserClient,
  input: {
    marketId: string;
    cursor: BusinessTriageCursor | null;
    limit?: number;
  },
): Promise<{ page: SuperAdminPendingBusinessPage | null; error: unknown }> {
  const limit = input.limit ?? SUPER_ADMIN_BUSINESS_TRIAGE_PAGE_SIZE;
  if (input.cursor && input.cursor.marketId !== input.marketId) {
    return { page: null, error: contractError() };
  }
  const result = await client.rpc("list_super_admin_pending_businesses", {
    p_market_id: input.marketId,
    p_limit: limit,
    ...(input.cursor
      ? {
          p_after_submitted_at: input.cursor.submittedAt,
          p_after_business_id: input.cursor.businessId,
        }
      : {}),
  });
  const page = result.error
    ? null
    : parseSuperAdminPendingBusinessPage(result.data, limit, {
        marketId: input.marketId,
        cursor: input.cursor,
      });
  return {
    page,
    error: result.error ?? (page ? null : contractError()),
  };
}
