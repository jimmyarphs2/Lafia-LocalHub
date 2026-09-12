import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  applyAuthResponseHeaders,
  AUTH_RETURN_COOKIE,
  authReturnCookieName,
  authReturnCookieOptions,
  isSameOrigin,
  parsePkceFlowId,
  safeAuthReturnPath,
  serializeAuthReturnCookie,
  supabaseAuthCookieOptions,
} from "@/lib/auth/redirects";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { getAppUrl, getPublicSupabaseConfig } from "@/lib/config/env";
import { readBoundedUrlEncodedForm } from "@/lib/http/bounded-body";
import { getServerAdminSupabaseClient } from "@/lib/supabase/admin";

const MAX_PROVIDER_AUTH_FORM_BYTES = 4 * 1024;

const providerSchema = z.object({
  provider: z.literal("google"),
  next: z.string().max(2048).optional(),
});

function authFailure(error: "auth_failed" | "configuration") {
  const response = NextResponse.redirect(
    new URL(`/auth?error=${error}`, getAppUrl()),
    303,
  );
  applyAuthResponseHeaders(response.headers);
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
    MAX_PROVIDER_AUTH_FORM_BYTES,
  );
  if (!formData) {
    return authFailure("auth_failed");
  }
  const parsed = providerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return authFailure("auth_failed");
  const config = getPublicSupabaseConfig();
  if (!config) return authFailure("configuration");
  const rateLimitClient = getServerAdminSupabaseClient();
  if (
    !rateLimitClient ||
    (await consumeAuthRateLimit(rateLimitClient, "oauth_sign_in", request)) !==
      "allowed"
  ) {
    return authFailure("auth_failed");
  }

  const next = safeAuthReturnPath(parsed.data.next);
  const response = NextResponse.redirect(new URL("/auth", getAppUrl()), 303);
  applyAuthResponseHeaders(response.headers);
  response.cookies.set(
    AUTH_RETURN_COOKIE,
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
        values: { name: string; value: string; options: CookieOptions }[],
        headers: Record<string, string>,
      ) {
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        applyAuthResponseHeaders(response.headers, headers);
      },
    },
  });
  const callback = new URL("/auth/callback", getAppUrl());
  let data: { flowId?: string | null; url?: string | null } | null = null;
  let error: unknown = null;
  try {
    const result = await supabase.auth.signInWithOAuth({
      provider: parsed.data.provider,
      options: { redirectTo: callback.toString() },
    });
    data = result.data;
    error = result.error;
  } catch {
    error = true;
  }
  const flowId = parsePkceFlowId(data?.flowId);
  const invalidFlowId = data?.flowId != null && !flowId;
  response.headers.set(
    "Location",
    error || !data?.url || invalidFlowId
      ? new URL("/auth?error=auth_failed", getAppUrl()).toString()
      : data.url,
  );
  if (error || !data?.url || invalidFlowId) {
    response.cookies.set(AUTH_RETURN_COOKIE, "", {
      ...authReturnCookieOptions(),
      maxAge: 0,
    });
    if (flowId)
      response.cookies.set(authReturnCookieName(flowId), "", {
        ...authReturnCookieOptions(),
        maxAge: 0,
      });
  } else if (flowId) {
    // Return destinations are correlated per PKCE flow so two OAuth tabs
    // cannot overwrite one another's post-auth destination.
    response.cookies.set(AUTH_RETURN_COOKIE, "", {
      ...authReturnCookieOptions(),
      maxAge: 0,
    });
    response.cookies.set(
      authReturnCookieName(flowId),
      serializeAuthReturnCookie(next),
      authReturnCookieOptions(),
    );
  }
  return response;
}
