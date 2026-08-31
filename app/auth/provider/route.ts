import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isSameOrigin, safeReturnPath } from "@/lib/auth/redirects";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { getAppUrl, getPublicSupabaseConfig } from "@/lib/config/env";
import { readBoundedUrlEncodedForm } from "@/lib/http/bounded-body";
import { getServerAdminSupabaseClient } from "@/lib/supabase/admin";

const MAX_PROVIDER_AUTH_FORM_BYTES = 4 * 1024;

const providerSchema = z.object({
  provider: z.enum(["google", "facebook"]),
  next: z.string().optional(),
});

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  const formData = await readBoundedUrlEncodedForm(
    request,
    MAX_PROVIDER_AUTH_FORM_BYTES,
  );
  if (!formData) {
    return NextResponse.redirect(
      new URL("/auth?error=auth_failed", getAppUrl()),
      303,
    );
  }
  const parsed = providerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return NextResponse.redirect(
      new URL("/auth?error=auth_failed", getAppUrl()),
      303,
    );
  const config = getPublicSupabaseConfig();
  if (!config)
    return NextResponse.redirect(
      new URL("/auth?error=configuration", getAppUrl()),
      303,
    );
  const response = NextResponse.redirect(new URL("/auth", getAppUrl()), 303);
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(
        values: { name: string; value: string; options: CookieOptions }[],
      ) {
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  const rateLimitClient = getServerAdminSupabaseClient();
  if (
    !rateLimitClient ||
    (await consumeAuthRateLimit(rateLimitClient, "oauth_sign_in", request)) !==
      "allowed"
  ) {
    return NextResponse.redirect(
      new URL("/auth?error=auth_failed", getAppUrl()),
      303,
    );
  }
  const callback = new URL("/auth/callback", getAppUrl());
  callback.searchParams.set("next", safeReturnPath(parsed.data.next));
  let data: { url?: string | null } | null = null;
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
  response.headers.set(
    "Location",
    error || !data?.url
      ? new URL("/auth?error=auth_failed", getAppUrl()).toString()
      : data.url,
  );
  return response;
}
