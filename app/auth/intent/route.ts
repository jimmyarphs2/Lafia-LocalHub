import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  authCookieOptions,
  GUEST_INTENT_COOKIE,
  isSameOrigin,
  safeReturnPath,
  serializeGuestIntentCookie,
} from "@/lib/auth/redirects";
import { getAuthRateLimitIdentifier } from "@/lib/auth/rate-limit";
import { getAppUrl, getPublicSupabaseConfig } from "@/lib/config/env";
import { readBoundedUrlEncodedForm } from "@/lib/http/bounded-body";
import { getServerAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

const MAX_INTENT_AUTH_FORM_BYTES = 32 * 1024;

const intentSchema = z.object({
  action: z.enum(["continue", "sign_in"]),
  return_to: z.string().min(1).max(2048),
  payload: z.string().min(2).max(8192),
});

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  const formData = await readBoundedUrlEncodedForm(
    request,
    MAX_INTENT_AUTH_FORM_BYTES,
  );
  if (!formData) {
    return NextResponse.json({ error: "Invalid intent." }, { status: 400 });
  }
  const parsed = intentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid intent." }, { status: 400 });
  const next = safeReturnPath(parsed.data.return_to);
  let payload: Json;
  try {
    payload = JSON.parse(parsed.data.payload) as Json;
  } catch {
    return NextResponse.json({ error: "Invalid intent." }, { status: 400 });
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload as object).length > 20
  )
    return NextResponse.json({ error: "Invalid intent." }, { status: 400 });
  const config = getPublicSupabaseConfig();
  if (!config)
    return NextResponse.redirect(
      new URL(
        `/auth?next=${encodeURIComponent(next)}&error=configuration`,
        getAppUrl(),
      ),
      303,
    );
  const response = NextResponse.redirect(
    new URL(`/auth?next=${encodeURIComponent(next)}`, getAppUrl()),
    303,
  );
  const supabase = getServerAdminSupabaseClient();
  const rateLimitIdentifier = getAuthRateLimitIdentifier(request);
  if (!supabase || !rateLimitIdentifier)
    return NextResponse.redirect(
      new URL(
        `/auth?next=${encodeURIComponent(next)}&error=auth_failed`,
        getAppUrl(),
      ),
      303,
    );
  let data: unknown;
  let error: unknown;
  try {
    const result = await supabase.rpc("create_guest_intent", {
      p_kind: parsed.data.action,
      p_return_to: next,
      p_payload: payload,
      p_rate_limit_key: rateLimitIdentifier,
    });
    data = result.data;
    error = result.error;
  } catch {
    error = true;
  }
  const record = Array.isArray(data) ? data[0] : data;
  if (
    error ||
    !record ||
    typeof record.id !== "string" ||
    typeof record.secret !== "string"
  )
    return NextResponse.redirect(
      new URL(
        `/auth?next=${encodeURIComponent(next)}&error=auth_failed`,
        getAppUrl(),
      ),
      303,
    );
  let serializedIntent: string;
  try {
    serializedIntent = serializeGuestIntentCookie(record.id, record.secret);
  } catch {
    return NextResponse.redirect(
      new URL(
        `/auth?next=${encodeURIComponent(next)}&error=auth_failed`,
        getAppUrl(),
      ),
      303,
    );
  }
  response.cookies.set(
    GUEST_INTENT_COOKIE,
    serializedIntent,
    authCookieOptions(),
  );
  return response;
}
