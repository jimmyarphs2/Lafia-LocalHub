import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  applyAuthResponseHeaders,
  AUTH_RETURN_COOKIE,
  authReturnCookieOptions,
  authReturnStateCookieName,
  isSameOrigin,
  safeAuthReturnPath,
  serializeAuthReturnCookie,
  supabaseAuthCookieOptions,
} from "@/lib/auth/redirects";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { getAppUrl, getPublicSupabaseConfig } from "@/lib/config/env";
import { readBoundedUrlEncodedForm } from "@/lib/http/bounded-body";
import { getServerAdminSupabaseClient } from "@/lib/supabase/admin";

const MAX_EMAIL_AUTH_FORM_BYTES = 4 * 1024;

const formSchema = z.object({
  email: z.string().trim().email().max(254),
  next: z.string().max(2048).optional(),
});

type AuthRedirectState =
  { notice: "check_email" } | { error: "auth_failed" | "configuration" };

function authRedirect(state: AuthRedirectState, clearReturn = true) {
  const destination = new URL("/auth", getAppUrl());
  if ("notice" in state) {
    destination.searchParams.set("notice", state.notice);
  } else {
    destination.searchParams.set("error", state.error);
  }
  const response = NextResponse.redirect(destination, { status: 303 });
  applyAuthResponseHeaders(response.headers);
  if (clearReturn)
    response.cookies.set(AUTH_RETURN_COOKIE, "", {
      ...authReturnCookieOptions(),
      maxAge: 0,
    });
  return response;
}

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
    MAX_EMAIL_AUTH_FORM_BYTES,
  );
  if (!formData) {
    return authRedirect({ error: "auth_failed" });
  }
  const parsed = formSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return authRedirect({ error: "auth_failed" });
  }

  const next = safeAuthReturnPath(parsed.data.next);
  const config = getPublicSupabaseConfig();
  if (!config) {
    return authRedirect({ error: "configuration" });
  }

  const rateLimitClient = getServerAdminSupabaseClient();
  if (
    !rateLimitClient ||
    (await consumeAuthRateLimit(rateLimitClient, "email_sign_in", request)) !==
      "allowed"
  ) {
    return authRedirect({ error: "auth_failed" });
  }

  const response = authRedirect({ notice: "check_email" }, false);
  const returnState = crypto.randomUUID();
  const returnCookieName = authReturnStateCookieName(returnState);
  if (!returnCookieName) return authRedirect({ error: "auth_failed" });
  response.cookies.set(AUTH_RETURN_COOKIE, "", {
    ...authReturnCookieOptions(),
    maxAge: 0,
  });
  response.cookies.set(
    returnCookieName,
    serializeAuthReturnCookie(next),
    authReturnCookieOptions(),
  );
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
  const callback = new URL("/auth/callback", getAppUrl());
  callback.searchParams.set("return_state", returnState);
  let providerError: unknown = null;
  try {
    providerError = (
      await supabase.auth.signInWithOtp({
        email: parsed.data.email,
        options: { emailRedirectTo: callback.toString() },
      })
    ).error;
  } catch {
    providerError = true;
    // Return the same generic outcome for provider/network failures to avoid
    // disclosing account state or allowing email enumeration.
  }
  if (providerError)
    response.cookies.set(returnCookieName, "", {
      ...authReturnCookieOptions(),
      maxAge: 0,
    });
  return response;
}
