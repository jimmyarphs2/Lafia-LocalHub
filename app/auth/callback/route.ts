import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  applyAuthResponseHeaders,
  AUTH_RETURN_COOKIE,
  authCookieOptions,
  authReturnCookieName,
  authReturnCookieOptions,
  authReturnStateCookieName,
  GUEST_INTENT_COOKIE,
  parseAuthReturnCookie,
  parseAuthReturnState,
  parseGuestIntentCookie,
  parsePkceFlowId,
  serializeAuthReturnCookie,
  supabaseAuthCookieOptions,
} from "@/lib/auth/redirects";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { getAppUrl, getPublicSupabaseConfig } from "@/lib/config/env";
import { getServerAdminSupabaseClient } from "@/lib/supabase/admin";
import { parseGuestIntentClaim } from "@/lib/requests/guest-claim";
import {
  listingCommitmentConfirmationPath,
  listingCommitmentRecoveryPath,
} from "@/lib/orders/navigation";
import { parseDemandConfirmationPath } from "@/lib/demand/contract";

function setAuthFailure(
  response: NextResponse,
  error: "auth_failed" | "configuration",
  stage:
    | "configuration"
    | "invalid_correlation"
    | "missing_code"
    | "missing_correlation_cookie"
    | "rate_limit"
    | "code_exchange"
    | "session_validation",
) {
  if (process.env.NODE_ENV === "production") {
    // Deliberately omit codes, flow IDs, cookies, destinations, and user data.
    console.warn("localhub.auth.callback.failed", { stage });
  }
  response.headers.set(
    "Location",
    new URL(`/auth?error=${error}`, getAppUrl()).toString(),
  );
  return response;
}

export async function GET(request: NextRequest) {
  const incoming = new URL(request.url);
  const code = incoming.searchParams.get("code");
  const rawFlowId = incoming.searchParams.get("sb_flow_id");
  const flowId = parsePkceFlowId(rawFlowId);
  const rawReturnState = incoming.searchParams.get("return_state");
  const returnState = parseAuthReturnState(rawReturnState);
  const flowReturnCookieName = authReturnCookieName(flowId);
  const stateReturnCookieName = authReturnStateCookieName(returnState);
  const returnCookieName = stateReturnCookieName ?? flowReturnCookieName;
  const scopedReturn = Boolean(returnState || flowId);
  const flowReturnCookie = flowId
    ? request.cookies.get(flowReturnCookieName)
    : undefined;
  const flowReturnValue = flowId
    ? parseAuthReturnCookie(flowReturnCookie?.value)
    : null;
  const stateReturnValue = stateReturnCookieName
    ? parseAuthReturnCookie(request.cookies.get(stateReturnCookieName)?.value)
    : null;
  const scopedReturnValue = stateReturnValue ?? flowReturnValue;
  const next =
    scopedReturnValue ??
    (!scopedReturn
      ? parseAuthReturnCookie(request.cookies.get(AUTH_RETURN_COOKIE)?.value)
      : null) ??
    "/";
  const response = NextResponse.redirect(new URL(next, getAppUrl()), 303);
  applyAuthResponseHeaders(response.headers);
  response.cookies.set(AUTH_RETURN_COOKIE, "", {
    ...authReturnCookieOptions(),
    maxAge: 0,
  });
  if (returnCookieName !== AUTH_RETURN_COOKIE)
    response.cookies.set(returnCookieName, "", {
      ...authReturnCookieOptions(),
      maxAge: 0,
    });
  if (
    flowReturnCookieName !== AUTH_RETURN_COOKIE &&
    flowReturnCookieName !== returnCookieName
  )
    response.cookies.set(flowReturnCookieName, "", {
      ...authReturnCookieOptions(),
      maxAge: 0,
    });
  const config = getPublicSupabaseConfig();

  if (!config)
    return setAuthFailure(response, "configuration", "configuration");
  if (!code) return setAuthFailure(response, "auth_failed", "missing_code");
  if (
    (rawFlowId !== null && !flowId) ||
    (rawReturnState !== null && !returnState) ||
    // Email PKCE legitimately carries both parameters, but provider OAuth and
    // email continuations must never contribute two competing app markers.
    (rawFlowId !== null &&
      rawReturnState !== null &&
      flowReturnCookie !== undefined) ||
    (rawFlowId === null && rawReturnState === null)
  ) {
    return setAuthFailure(response, "auth_failed", "invalid_correlation");
  }
  // Provider/email initiation always reserves an HttpOnly marker for the exact
  // flow. A missing marker means this callback is expired, consumed, or was not
  // initiated by this browser, so do not consume its authorization code.
  if (scopedReturn && !scopedReturnValue) {
    return setAuthFailure(
      response,
      "auth_failed",
      "missing_correlation_cookie",
    );
  }

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

  const rateLimitClient = getServerAdminSupabaseClient();
  let rateLimitAllowed = false;
  try {
    rateLimitAllowed = Boolean(
      rateLimitClient &&
      (await consumeAuthRateLimit(
        rateLimitClient,
        "auth_callback",
        request,
      )) === "allowed",
    );
  } catch {
    rateLimitAllowed = false;
  }
  if (!rateLimitAllowed) {
    return setAuthFailure(response, "auth_failed", "rate_limit");
  }
  let exchangeError: unknown;
  try {
    exchangeError = (
      await supabase.auth.exchangeCodeForSession(
        code,
        flowId ? { flowId } : undefined,
      )
    ).error;
  } catch {
    exchangeError = true;
  }
  if (exchangeError) {
    return setAuthFailure(response, "auth_failed", "code_exchange");
  }
  let userData: { user: unknown } | null = null;
  let userError: unknown;
  try {
    const result = await supabase.auth.getUser();
    userData = result.data;
    userError = result.error;
  } catch {
    userError = true;
  }
  if (userError || !userData?.user) {
    return setAuthFailure(response, "auth_failed", "session_validation");
  }

  // A demand continuation is independent of older guest commitments. Preserve
  // that unrelated capability and never let it override this exact return path.
  const intent = parseDemandConfirmationPath(next)
    ? null
    : parseGuestIntentCookie(request.cookies.get(GUEST_INTENT_COOKIE)?.value);
  if (intent) {
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
    // Only the opaque intent UUID may appear in a continuation URL. The cookie is the capability.
    if (outcome.state === "transient") {
      response.headers.set(
        "Location",
        new URL(
          `/auth?resume=1&intent=${encodeURIComponent(intent.id)}`,
          getAppUrl(),
        ).toString(),
      );
      response.cookies.set(
        AUTH_RETURN_COOKIE,
        serializeAuthReturnCookie(next),
        authReturnCookieOptions(),
      );
    } else if (outcome.state === "terminal") {
      response.headers.set(
        "Location",
        new URL(
          listingCommitmentRecoveryPath(outcome.returnTo, next),
          getAppUrl(),
        ).toString(),
      );
      response.cookies.set(GUEST_INTENT_COOKIE, "", {
        ...authCookieOptions(),
        maxAge: 0,
      });
    } else {
      const commitmentKind =
        outcome.kind === "listing_request" || outcome.kind === "listing_order"
          ? outcome.kind
          : null;
      const destination = commitmentKind
        ? listingCommitmentConfirmationPath(
            outcome.returnTo,
            intent.id,
            commitmentKind,
          )
        : outcome.returnTo;
      response.headers.set(
        "Location",
        new URL(
          destination ?? "/auth?error=auth_failed",
          getAppUrl(),
        ).toString(),
      );
      response.cookies.set(GUEST_INTENT_COOKIE, "", {
        ...authCookieOptions(),
        maxAge: 0,
      });
    }
  }
  return response;
}
