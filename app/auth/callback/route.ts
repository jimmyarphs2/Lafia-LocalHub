import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  authCookieOptions,
  GUEST_INTENT_COOKIE,
  parseGuestIntentCookie,
  safeReturnPath,
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

export async function GET(request: NextRequest) {
  const incoming = new URL(request.url);
  const code = incoming.searchParams.get("code");
  const next = safeReturnPath(incoming.searchParams.get("next"));
  const response = NextResponse.redirect(new URL(next, getAppUrl()), 303);
  const config = getPublicSupabaseConfig();

  if (!config || !code)
    return NextResponse.redirect(
      new URL("/auth?error=configuration", getAppUrl()),
      303,
    );

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
    (await consumeAuthRateLimit(rateLimitClient, "auth_callback", request)) !==
      "allowed"
  ) {
    response.headers.set(
      "Location",
      new URL("/auth?error=auth_failed", getAppUrl()).toString(),
    );
    return response;
  }
  let exchangeError: unknown;
  try {
    exchangeError = (await supabase.auth.exchangeCodeForSession(code)).error;
  } catch {
    exchangeError = true;
  }
  if (exchangeError) {
    response.headers.set(
      "Location",
      new URL("/auth?error=auth_failed", getAppUrl()).toString(),
    );
    return response;
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
    response.headers.set(
      "Location",
      new URL("/auth?error=auth_failed", getAppUrl()).toString(),
    );
    return response;
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
    if (outcome.state === "transient")
      response.headers.set(
        "Location",
        new URL(
          `/auth?resume=1&intent=${encodeURIComponent(intent.id)}&next=${encodeURIComponent(next)}`,
          getAppUrl(),
        ).toString(),
      );
    else if (outcome.state === "terminal") {
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
