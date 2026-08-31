import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isSameOrigin, safeReturnPath } from "@/lib/auth/redirects";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { getAppUrl, getPublicSupabaseConfig } from "@/lib/config/env";
import { readBoundedUrlEncodedForm } from "@/lib/http/bounded-body";
import { getServerAdminSupabaseClient } from "@/lib/supabase/admin";

const MAX_EMAIL_AUTH_FORM_BYTES = 4 * 1024;

const formSchema = z.object({
  email: z.string().trim().email().max(254),
  next: z.string().optional(),
});

type AuthRedirectState =
  { notice: "check_email" } | { error: "auth_failed" | "configuration" };

function authRedirect(next: string, state: AuthRedirectState) {
  const destination = new URL("/auth", getAppUrl());
  destination.searchParams.set("next", safeReturnPath(next));
  if ("notice" in state) {
    destination.searchParams.set("notice", state.notice);
  } else {
    destination.searchParams.set("error", state.error);
  }
  return NextResponse.redirect(destination, { status: 303 });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  const formData = await readBoundedUrlEncodedForm(
    request,
    MAX_EMAIL_AUTH_FORM_BYTES,
  );
  if (!formData) {
    return authRedirect("/", { error: "auth_failed" });
  }
  const rawNext = formData.get("next");
  const fallbackNext = safeReturnPath(
    typeof rawNext === "string" ? rawNext : undefined,
  );
  const parsed = formSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return authRedirect(fallbackNext, { error: "auth_failed" });
  }

  const next = safeReturnPath(parsed.data.next);
  const config = getPublicSupabaseConfig();
  if (!config) {
    return authRedirect(next, { error: "configuration" });
  }

  const response = authRedirect(next, { notice: "check_email" });
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[],
      ) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  const rateLimitClient = getServerAdminSupabaseClient();
  if (
    !rateLimitClient ||
    (await consumeAuthRateLimit(rateLimitClient, "email_sign_in", request)) !==
      "allowed"
  ) {
    return authRedirect(next, { error: "auth_failed" });
  }
  const callback = new URL("/auth/callback", getAppUrl());
  callback.searchParams.set("next", next);
  try {
    await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: { emailRedirectTo: callback.toString() },
    });
  } catch {
    // Return the same generic outcome for provider/network failures to avoid
    // disclosing account state or allowing email enumeration.
  }
  return response;
}
