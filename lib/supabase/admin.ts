import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getPublicSupabaseConfig } from "@/lib/config/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Server-only administrative client for narrowly scoped, route-owned work.
 * For user-initiated media changes, it may mutate only exact canonical objects
 * and metadata after a user-scoped client authorizes the listing manager. The
 * protected cleanup runner may act only on exact paths claimed by its
 * service-role RPC. This client must never supply user authorization or enter
 * browser code.
 */
export function getServerAdminSupabaseClient(): SupabaseClient<Database> | null {
  const config = getPublicSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !serviceRoleKey) return null;

  return createClient<Database>(config.url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
