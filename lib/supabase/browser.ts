"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPublicSupabaseConfig } from "@/lib/config/env";
import type { Database } from "@/lib/supabase/database.types";

let client: SupabaseClient<Database> | null = null;

/** Returns null in local demo/static builds where Supabase has not been provisioned. */
export function getBrowserSupabaseClient(): SupabaseClient<Database> | null {
  const config = getPublicSupabaseConfig();
  if (!config) return null;
  client ??= createBrowserClient<Database>(config.url, config.anonKey);
  return client;
}
