import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getAppUrl, getPublicSupabaseConfig } from "@/lib/config/env";
import { referralCodeSchema } from "@/lib/referrals/contract";
import { resolveReferralAcquisitionLink } from "@/lib/referrals/rpc";
import { marketSlugSchema } from "@/lib/requests/contract";
import type { Database } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const GENERIC_ONBOARDING_PATH = "/vendor/onboarding";

function noStoreRedirect(path: string) {
  const response = NextResponse.redirect(new URL(path, getAppUrl()), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function genericRedirect() {
  return noStoreRedirect(GENERIC_ONBOARDING_PATH);
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const parsedCode = referralCodeSchema.safeParse(code);
  if (!parsedCode.success) return genericRedirect();

  try {
    const config = getPublicSupabaseConfig();
    if (!config) return genericRedirect();

    const client = createClient<Database>(config.url, config.anonKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const result = await resolveReferralAcquisitionLink(
      client,
      parsedCode.data,
    );
    const resolution = result.error ? null : result.resolution;
    const marketSlug = marketSlugSchema.safeParse(resolution?.marketSlug);
    if (
      !resolution ||
      resolution.outcome !== "valid" ||
      resolution.target !== "merchant_onboarding" ||
      !marketSlug.success
    ) {
      return genericRedirect();
    }

    const canonicalPath = `/${marketSlug.data}/vendor/onboarding/referral`;
    if (resolution.canonicalTargetPath !== canonicalPath) {
      return genericRedirect();
    }
    return noStoreRedirect(canonicalPath);
  } catch {
    return genericRedirect();
  }
}
