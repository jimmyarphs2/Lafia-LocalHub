import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getPublicSupabaseConfig } from "@/lib/config/env";
import type { Database } from "@/lib/supabase/database.types";

/** Read-only server client. Session refresh belongs in proxy/route handlers. */
export async function getServerSupabaseClient(): Promise<SupabaseClient<Database> | null> {
  const config = getPublicSupabaseConfig();
  if (!config) return null;
  const cookieStore = await cookies();

  return createServerClient<Database>(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Server Components cannot write cookies. Proxy and route handlers own refresh.
      },
    },
  });
}
