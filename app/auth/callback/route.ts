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
) {
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
  const returnCookieName =
    authReturnStateCookieName(returnState) ?? authReturnCookieName(flowId);
  const scopedReturn = Boolean(returnState || flowId);
  const next =
    parseAuthReturnCookie(request.cookies.get(returnCookieName)?.value) ??
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
  const config = getPublicSupabaseConfig();

  if (!config) return setAuthFailure(response, "configuration");
  if (
    !code ||
    (rawFlowId !== null && !flowId) ||
    (rawReturnState !== null && !returnState)
  )
    return setAuthFailure(response, "auth_failed");

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
  if (
    !rateLimitClient ||
    (await consumeAuthRateLimit(rateLimitClient, "auth_callback", request)) !==
      "allowed"
  ) {
    return setAuthFailure(response, "auth_failed");
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
    return setAuthFailure(response, "auth_failed");
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
    return setAuthFailure(response, "auth_failed");
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
