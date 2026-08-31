import { NextResponse, type NextRequest } from "next/server";

import {
  authCookieOptions,
  GUEST_INTENT_COOKIE,
  isSameOrigin,
  serializeGuestIntentCookie,
} from "@/lib/auth/redirects";
import { getAuthRateLimitIdentifier } from "@/lib/auth/rate-limit";
import {
  getListingRouteKey,
  isPublishableCatalogRecord,
} from "@/lib/catalog/data";
import { getCatalogForMarket } from "@/lib/catalog/source";
import { getAppUrl } from "@/lib/config/env";
import { readBoundedUrlEncodedForm } from "@/lib/http/bounded-body";
import { orderQuantityFormSchema } from "@/lib/orders/contract";
import { createListingOrderIntent } from "@/lib/orders/rpc";
import { listingRouteSchema, marketSlugSchema } from "@/lib/requests/contract";
import { parseGuestIntentClaim } from "@/lib/requests/guest-claim";
import { getServerAdminSupabaseClient } from "@/lib/supabase/admin";
import { getServerSupabaseClient } from "@/lib/supabase/server";

const MAX_ORDER_INTENT_FORM_BYTES = 4 * 1024;

function recoveryPath(market: string, listing: string) {
  return `/${market}/listings/${listing}?order=unavailable`;
}

function singleFormValue(
  formData: Pick<URLSearchParams, "getAll">,
  key: string,
): string | null {
  const values = formData.getAll(key);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ market: string; listing: string }> },
) {
  const { market, listing: listingRoute } = await context.params;
  if (
    !marketSlugSchema.safeParse(market).success ||
    !listingRouteSchema.safeParse(listingRoute).success
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
    MAX_ORDER_INTENT_FORM_BYTES,
  );
  const quantity = orderQuantityFormSchema.safeParse(
    formData ? singleFormValue(formData, "quantity") : null,
  );
  if (!quantity.success) {
    return NextResponse.redirect(
      new URL(recoveryPath(market, listingRoute), getAppUrl()),
      303,
    );
  }

  const catalog = await getCatalogForMarket(market).catch(() => null);
  const listing =
    catalog?.state === "ready"
      ? catalog.listings.find(
          (item) => getListingRouteKey(item) === listingRoute,
        )
      : undefined;
  if (
    !listing?.id ||
    !isPublishableCatalogRecord(listing) ||
    listing.marketId !== catalog?.market?.id ||
    listing.isOrderable !== true ||
    !Number.isSafeInteger(listing.priceMinor) ||
    (listing.priceMinor ?? 0) <= 0 ||
    !listing.currencyCode ||
    !/^[A-Z]{3}$/.test(listing.currencyCode)
  ) {
    return NextResponse.redirect(
      new URL(recoveryPath(market, listingRoute), getAppUrl()),
      303,
    );
  }

  const rateLimitKey = getAuthRateLimitIdentifier(request);
  const admin = getServerAdminSupabaseClient();
  if (!admin || !rateLimitKey) {
    return NextResponse.redirect(
      new URL(recoveryPath(market, listingRoute), getAppUrl()),
      303,
    );
  }
  const created = await createListingOrderIntent(admin, {
    listingId: listing.id,
    quantity: quantity.data,
    rateLimitKey,
  }).catch(() => ({ capability: null, error: true }));
  if (created.error || !created.capability) {
    return NextResponse.redirect(
      new URL(recoveryPath(market, listingRoute), getAppUrl()),
      303,
    );
  }

  let serializedIntent: string;
  try {
    serializedIntent = serializeGuestIntentCookie(
      created.capability.id,
      created.capability.secret,
    );
  } catch {
    return NextResponse.redirect(
      new URL(recoveryPath(market, listingRoute), getAppUrl()),
      303,
    );
  }

  const confirmationPath = `/${market}/listings/${listingRoute}/order?intent=${encodeURIComponent(created.capability.id)}`;
  const response = NextResponse.redirect(
    new URL(`/auth?next=${encodeURIComponent(confirmationPath)}`, getAppUrl()),
    303,
  );
  response.cookies.set(
    GUEST_INTENT_COOKIE,
    serializedIntent,
    authCookieOptions(),
  );

  const client = await getServerSupabaseClient().catch(() => null);
  const user = client
    ? await client.auth.getUser().catch(() => ({ data: { user: null } }))
    : null;
  if (!client || !user?.data.user) return response;

  let claim: { data: unknown; error: unknown };
  try {
    claim = await client.rpc("claim_guest_intent", {
      p_intent_id: created.capability.id,
      p_secret: created.capability.secret,
    });
  } catch {
    claim = { data: null, error: true };
  }
  const outcome = parseGuestIntentClaim(claim.data, claim.error);
  if (outcome.state === "claimed" && outcome.kind === "listing_order") {
    response.headers.set(
      "Location",
      new URL(confirmationPath, getAppUrl()).toString(),
    );
    response.cookies.set(GUEST_INTENT_COOKIE, "", {
      ...authCookieOptions(),
      maxAge: 0,
    });
  } else if (outcome.state === "terminal" || outcome.state === "claimed") {
    response.headers.set(
      "Location",
      new URL(recoveryPath(market, listingRoute), getAppUrl()).toString(),
    );
    response.cookies.set(GUEST_INTENT_COOKIE, "", {
      ...authCookieOptions(),
      maxAge: 0,
    });
  } else {
    response.headers.set(
      "Location",
      new URL(
        `/auth?resume=1&intent=${encodeURIComponent(created.capability.id)}&next=${encodeURIComponent(confirmationPath)}`,
        getAppUrl(),
      ).toString(),
    );
  }
  return response;
}
