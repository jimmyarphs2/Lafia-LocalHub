import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicSupabaseConfig } from "@/lib/config/env";
import {
  applyAuthResponseHeaders,
  supabaseAuthCookieOptions,
} from "@/lib/auth/redirects";
import type { Database } from "@/lib/supabase/database.types";

export async function refreshSupabaseSession(request: NextRequest) {
  const connection = getPublicSupabaseConfig();
  if (!connection) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(
    connection.url,
    connection.anonKey,
    {
      auth: {
        experimental: { appendPkceFlowIdToRedirects: true },
      },
      cookieOptions: supabaseAuthCookieOptions(),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options: CookieOptions;
          }[],
          authHeaders: Record<string, string>,
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          applyAuthResponseHeaders(response.headers, authHeaders);
        },
      },
    },
  );

  // getUser validates the token and allows SSR to receive refreshed cookies.
  try {
    await supabase.auth.getUser();
  } catch {
    /* Provider outage: preserve the request response. */
  }
  return response;
}
