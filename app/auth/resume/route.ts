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
  parseAuthReturnCookie,
  parseGuestIntentCookie,
  safeAuthReturnPath,
  serializeAuthReturnCookie,
  supabaseAuthCookieOptions,
} from "@/lib/auth/redirects";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { getAppUrl, getPublicSupabaseConfig } from "@/lib/config/env";
import { readBoundedUrlEncodedForm } from "@/lib/http/bounded-body";
import { requestIntentIdSchema } from "@/lib/requests/contract";
import { parseGuestIntentClaim } from "@/lib/requests/guest-claim";
import { getServerAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  listingCommitmentConfirmationPath,
  listingCommitmentRecoveryPath,
} from "@/lib/orders/navigation";
import { parseDemandConfirmationPath } from "@/lib/demand/contract";

const MAX_RESUME_FORM_BYTES = 4 * 1024;
const resumeSchema = z.object({
  intent: requestIntentIdSchema,
  next: z.string().max(2048).optional(),
});

/** This endpoint is intentionally POST-only; GET requests can never claim an intent. */
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
    MAX_RESUME_FORM_BYTES,
  );
  const parsed =
    formData && resumeSchema.safeParse(Object.fromEntries(formData));
  const cookieNext = parseAuthReturnCookie(
    request.cookies.get(AUTH_RETURN_COOKIE)?.value,
  );
  const recoveryNext =
    cookieNext ??
    (parsed?.success ? safeAuthReturnPath(parsed.data.next) : "/");
  const retry = parsed?.success
    ? `/auth?resume=1&intent=${encodeURIComponent(parsed.data.intent)}`
    : "/auth?error=auth_failed";
  const response = NextResponse.redirect(new URL(retry, getAppUrl()), 303);
  applyAuthResponseHeaders(response.headers);
  if (parsed?.success) {
    response.cookies.set(
      AUTH_RETURN_COOKIE,
      serializeAuthReturnCookie(recoveryNext),
      authReturnCookieOptions(),
    );
  } else {
    response.cookies.set(AUTH_RETURN_COOKIE, "", {
      ...authReturnCookieOptions(),
      maxAge: 0,
    });
  }
  if (!parsed || !parsed.success) return response;
  if (parseDemandConfirmationPath(recoveryNext)) {
    // A demand continuation never claims, clears, or follows an unrelated
    // guest-intent capability, even if a forged resume form includes one.
    response.headers.set(
      "Location",
      new URL(recoveryNext, getAppUrl()).toString(),
    );
    response.cookies.set(AUTH_RETURN_COOKIE, "", {
      ...authReturnCookieOptions(),
      maxAge: 0,
    });
    return response;
  }
  const intent = parseGuestIntentCookie(
    request.cookies.get(GUEST_INTENT_COOKIE)?.value,
  );
  const config = getPublicSupabaseConfig();
  if (!intent || intent.id !== parsed.data.intent || !config) return response;

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
  const rateLimitClient = getServerAdminSupabaseClient();
  if (
    !rateLimitClient ||
    (await consumeAuthRateLimit(rateLimitClient, "intent_resume", request)) !==
      "allowed"
  ) {
    return response;
  }
  const user = await supabase.auth
    .getUser()
    .catch(() => ({ data: { user: null } }));
  if (!user.data.user) return response;
  let claim: { data: unknown; error: unknown };
  try {
    claim = await supabase.rpc("claim_guest_intent", {
      p_intent_id: intent.id,
      p_secret: intent.secret,
    });
  } catch {
    claim = { data: null, error: true };
  }
  const outcome = parseGuestIntentClaim(claim.data, claim.error);
  if (outcome.state === "transient") return response;
  if (outcome.state === "terminal") {
    response.headers.set(
      "Location",
      new URL(
        listingCommitmentRecoveryPath(outcome.returnTo, recoveryNext),
        getAppUrl(),
      ).toString(),
    );
    response.cookies.set(GUEST_INTENT_COOKIE, "", {
      ...authCookieOptions(),
      maxAge: 0,
    });
    response.cookies.set(AUTH_RETURN_COOKIE, "", {
      ...authReturnCookieOptions(),
      maxAge: 0,
    });
    return response;
  }
  response.headers.set(
    "Location",
    new URL(
      outcome.kind === "listing_request" || outcome.kind === "listing_order"
        ? (listingCommitmentConfirmationPath(
            outcome.returnTo,
            intent.id,
            outcome.kind,
          ) ?? "/auth?error=auth_failed")
        : outcome.returnTo,
      getAppUrl(),
    ).toString(),
  );
  response.cookies.set(GUEST_INTENT_COOKIE, "", {
    ...authCookieOptions(),
    maxAge: 0,
  });
  response.cookies.set(AUTH_RETURN_COOKIE, "", {
    ...authReturnCookieOptions(),
    maxAge: 0,
  });
  return response;
}
