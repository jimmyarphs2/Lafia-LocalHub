import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  applyAuthResponseHeaders,
  AUTH_RETURN_COOKIE,
  authCookieOptions,
  authReturnCookieOptions,
  GUEST_INTENT_COOKIE,
  isSameOrigin,
  safeAuthReturnPath,
  supabaseAuthCookieOptions,
} from "@/lib/auth/redirects";
import { getAppUrl, getPublicSupabaseConfig } from "@/lib/config/env";
import { readBoundedUrlEncodedForm } from "@/lib/http/bounded-body";

const MAX_LOGOUT_FORM_BYTES = 4 * 1024;
const logoutSchema = z.object({ next: z.string().max(2048).optional() });

function supabaseAuthCookiePrefix(url: string) {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

function reportProviderSignOutFailure() {
  if (process.env.NODE_ENV === "production") {
    // No cookie, user, provider, or destination data is logged.
    console.warn("localhub.auth.logout.failed", {
      stage: "provider_sign_out",
    });
  }
}

function clearLocalAuthState(
  request: NextRequest,
  response: NextResponse,
  supabaseUrl: string | null,
) {
  request.cookies.getAll().forEach(({ name }) => {
    if (
      name === AUTH_RETURN_COOKIE ||
      name.startsWith(`${AUTH_RETURN_COOKIE}-`)
    )
      response.cookies.set(name, "", {
        ...authReturnCookieOptions(),
        expires: new Date(0),
        maxAge: 0,
      });
  });
  // Clear the base name even when it was not present in the request.
  response.cookies.set(AUTH_RETURN_COOKIE, "", {
    ...authReturnCookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  });
  response.cookies.set(GUEST_INTENT_COOKIE, "", {
    ...authCookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  });
  if (!supabaseUrl) return;

  const prefix = supabaseAuthCookiePrefix(supabaseUrl);
  request.cookies.getAll().forEach(({ name }) => {
    if (
      name === prefix ||
      name.startsWith(`${prefix}.`) ||
      name.startsWith(`${prefix}-`)
    ) {
      response.cookies.set(name, "", {
        ...supabaseAuthCookieOptions(),
        expires: new Date(0),
        maxAge: 0,
      });
    }
  });
}

/** Logout is deliberately POST-only so navigation/prefetch cannot mutate a session. */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    const denied = NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
    applyAuthResponseHeaders(denied.headers);
    return denied;
  }

  const formData = await readBoundedUrlEncodedForm(
    request,
    MAX_LOGOUT_FORM_BYTES,
  );
  const parsed = formData
    ? logoutSchema.safeParse(Object.fromEntries(formData))
    : null;
  const next = safeAuthReturnPath(
    parsed?.success ? parsed.data.next : undefined,
  );
  const response = NextResponse.redirect(new URL(next, getAppUrl()), 303);
  applyAuthResponseHeaders(response.headers);

  const config = getPublicSupabaseConfig();
  clearLocalAuthState(request, response, config?.url ?? null);
  if (!config) return response;

  const supabase = createServerClient(config.url, config.anonKey, {
    auth: {
      experimental: { appendPkceFlowIdToRedirects: true },
    },
    cookieOptions: supabaseAuthCookieOptions(),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        headers: Record<string, string>,
      ) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        applyAuthResponseHeaders(response.headers, headers);
      },
    },
  });
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) reportProviderSignOutFailure();
  } catch {
    // Expired or provider-unreachable sessions are still cleared locally.
    reportProviderSignOutFailure();
  }
  clearLocalAuthState(request, response, config.url);
  return response;
}
