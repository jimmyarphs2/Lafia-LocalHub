import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  authCookieOptions,
  GUEST_INTENT_COOKIE,
  isSameOrigin,
  serializeGuestIntentCookie,
} from "@/lib/auth/redirects";
import { getAuthRateLimitIdentifier } from "@/lib/auth/rate-limit";
import { getCatalogForMarket } from "@/lib/catalog/source";
import {
  getListingRouteKey,
  isPublishableCatalogRecord,
} from "@/lib/catalog/data";
import { normalizeSearchContext } from "@/components/commitment-link";
import { parseGuestIntentClaim } from "@/lib/requests/guest-claim";
import { createListingRequestIntent } from "@/lib/requests/rpc";
import {
  listingRequestActionSchema,
  listingRouteSchema,
  marketSlugSchema,
} from "@/lib/requests/contract";
import { getAppUrl } from "@/lib/config/env";
import { readBoundedUrlEncodedForm } from "@/lib/http/bounded-body";
import { getServerAdminSupabaseClient } from "@/lib/supabase/admin";
import { getServerSupabaseClient } from "@/lib/supabase/server";

const MAX_REQUEST_INTENT_FORM_BYTES = 4 * 1024;

const schema = z.object({
  requested_action: listingRequestActionSchema,
  search_context: z.string().max(512).optional(),
});

function recoveryPath(market: string, listing: string) {
  return `/${market}/listings/${listing}?request=unavailable`;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ market: string; listing: string }> },
) {
  const { market, listing: listingSlug } = await context.params;
  if (
    !marketSlugSchema.safeParse(market).success ||
    !listingRouteSchema.safeParse(listingSlug).success
  ) {
    return NextResponse.redirect(new URL("/", getAppUrl()), 303);
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  }
  const formData = await readBoundedUrlEncodedForm(
    request,
    MAX_REQUEST_INTENT_FORM_BYTES,
  );
  const parsed = formData && schema.safeParse(Object.fromEntries(formData));
  if (!parsed || !parsed.success) {
    return NextResponse.redirect(
      new URL(recoveryPath(market, listingSlug), getAppUrl()),
      303,
    );
  }

  const catalog = await getCatalogForMarket(market);
  const listing =
    catalog.state === "ready"
      ? catalog.listings.find(
          (item) => getListingRouteKey(item) === listingSlug,
        )
      : undefined;
  // The route and live catalog are authoritative; a form never supplies listing IDs or market IDs.
  if (
    !listing ||
    !listing.id ||
    !isPublishableCatalogRecord(listing) ||
    listing.marketId !== catalog.market?.id
  ) {
    return NextResponse.redirect(
      new URL(recoveryPath(market, listingSlug), getAppUrl()),
      303,
    );
  }

  const rateLimitKey = getAuthRateLimitIdentifier(request);
  const admin = getServerAdminSupabaseClient();
  if (!admin || !rateLimitKey) {
    return NextResponse.redirect(
      new URL(recoveryPath(market, listingSlug), getAppUrl()),
      303,
    );
  }
  const created = await createListingRequestIntent(admin, {
    listingId: listing.id,
    requestedAction: parsed.data.requested_action,
    searchContext: normalizeSearchContext(parsed.data.search_context) || null,
    rateLimitKey,
  }).catch(() => ({ data: null, error: true }));
  const row = Array.isArray(created.data) ? created.data[0] : created.data;
  if (
    created.error ||
    !row ||
    typeof (row as { id?: unknown }).id !== "string" ||
    typeof (row as { secret?: unknown }).secret !== "string"
  ) {
    // Kept generic: creation errors must not disclose listing or rate-limit state.
    return NextResponse.redirect(
      new URL(recoveryPath(market, listingSlug), getAppUrl()),
      303,
    );
  }
  const intent = row as { id: string; secret: string };
  let serializedIntent: string;
  try {
    serializedIntent = serializeGuestIntentCookie(intent.id, intent.secret);
  } catch {
    return NextResponse.redirect(
      new URL(recoveryPath(market, listingSlug), getAppUrl()),
      303,
    );
  }
  const confirmationPath = `/${market}/listings/${listingSlug}/request?intent=${encodeURIComponent(intent.id)}`;
  const response = NextResponse.redirect(
    new URL(`/auth?next=${encodeURIComponent(confirmationPath)}`, getAppUrl()),
    303,
  );
  response.cookies.set(
    GUEST_INTENT_COOKIE,
    serializedIntent,
    authCookieOptions(),
  );

  const client = await getServerSupabaseClient();
  const user = client
    ? await client.auth.getUser().catch(() => ({ data: { user: null } }))
    : null;
  if (!client || !user?.data.user) return response;

  let claim: { data: unknown; error: unknown };
  try {
    claim = await client.rpc("claim_guest_intent", {
      p_intent_id: intent.id,
      p_secret: intent.secret,
    });
  } catch {
    claim = { data: null, error: true };
  }
  const outcome = parseGuestIntentClaim(claim.data, claim.error);
  if (outcome.state === "claimed") {
    response.headers.set(
      "Location",
      new URL(confirmationPath, getAppUrl()).toString(),
    );
    response.cookies.set(GUEST_INTENT_COOKIE, "", {
      ...authCookieOptions(),
      maxAge: 0,
    });
  } else if (outcome.state === "terminal") {
    response.headers.set(
      "Location",
      new URL(recoveryPath(market, listingSlug), getAppUrl()).toString(),
    );
    response.cookies.set(GUEST_INTENT_COOKIE, "", {
      ...authCookieOptions(),
      maxAge: 0,
    });
  } else {
    response.headers.set(
      "Location",
      new URL(
        `/auth?resume=1&intent=${encodeURIComponent(intent.id)}&next=${encodeURIComponent(confirmationPath)}`,
        getAppUrl(),
      ).toString(),
    );
  }
  return response;
}
