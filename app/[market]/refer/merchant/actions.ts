"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { referralIdSchema } from "@/lib/referrals/contract";
import {
  createOrGetMyReferralLink,
  listMyReferralLinks,
  setMyReferralLinkEnabled,
} from "@/lib/referrals/rpc";
import { marketSlugSchema } from "@/lib/requests/contract";
import { getServerSupabaseClient } from "@/lib/supabase/server";

const createInputSchema = z.object({ market: marketSlugSchema }).strict();

const toggleInputSchema = z
  .object({
    market: marketSlugSchema,
    linkId: referralIdSchema,
    enabled: z.enum(["true", "false"]).transform((value) => value === "true"),
  })
  .strict();

type FailureCode = "unauthorized" | "unavailable" | "validation";

export type ReferralOwnerActionResult =
  | {
      ok: true;
      code: "created" | "updated";
      message: string;
    }
  | {
      ok: false;
      code: FailureCode;
      message: string;
    };

type UserClient = NonNullable<
  Awaited<ReturnType<typeof getServerSupabaseClient>>
>;

type OwnerContext =
  | { ok: true; client: UserClient; marketId: string }
  | { ok: false; result: ReferralOwnerActionResult };

function failure(
  code: FailureCode,
  message: string,
): ReferralOwnerActionResult {
  return { ok: false, code, message };
}

function singleFormValue(formData: FormData, key: string): string | null {
  const values = formData.getAll(key);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}

async function getOwnerContext(market: string): Promise<OwnerContext> {
  const client = await getServerSupabaseClient().catch(() => null);
  if (!client) {
    return {
      ok: false,
      result: failure(
        "unavailable",
        "Referral links are temporarily unavailable. Try again later.",
      ),
    };
  }

  const user = await client.auth.getUser().catch(() => null);
  if (!user?.data.user) {
    return {
      ok: false,
      result: failure(
        "unauthorized",
        "Your session has expired. Sign in again to manage referral links.",
      ),
    };
  }

  const access = await Promise.all([
    client.rpc("is_current_profile_active"),
    client
      .from("markets")
      .select("id,slug")
      .eq("slug", market)
      .eq("is_active", true)
      .maybeSingle(),
  ]).catch(() => null);
  if (!access) {
    return {
      ok: false,
      result: failure(
        "unavailable",
        "Referral links are temporarily unavailable. Try again later.",
      ),
    };
  }

  const [profileResult, marketResult] = access;
  if (profileResult.error || marketResult.error) {
    return {
      ok: false,
      result: failure(
        "unavailable",
        "Referral links are temporarily unavailable. Try again later.",
      ),
    };
  }
  if (profileResult.data !== true) {
    return {
      ok: false,
      result: failure(
        "unauthorized",
        "This account cannot manage referral links.",
      ),
    };
  }

  const marketId = referralIdSchema.safeParse(marketResult.data?.id);
  if (!marketId.success || marketResult.data?.slug !== market) {
    return {
      ok: false,
      result: failure(
        "validation",
        "This market is not available for referral links.",
      ),
    };
  }

  return { ok: true, client, marketId: marketId.data };
}

export async function createMerchantReferralLink(
  _previousState: ReferralOwnerActionResult | null,
  formData: FormData,
): Promise<ReferralOwnerActionResult> {
  const input = createInputSchema.safeParse({
    market: singleFormValue(formData, "market"),
  });
  if (!input.success) {
    return failure(
      "validation",
      "We could not verify this referral-link request.",
    );
  }

  const context = await getOwnerContext(input.data.market);
  if (!context.ok) return context.result;

  const result = await createOrGetMyReferralLink(
    context.client,
    context.marketId,
  ).catch(() => ({ link: null, error: true }));
  if (
    result.error ||
    !result.link ||
    result.link.marketId !== context.marketId
  ) {
    return failure(
      "unavailable",
      "We could not confirm this referral link. Try again later.",
    );
  }

  revalidatePath(`/${input.data.market}/refer/merchant`);
  return {
    ok: true,
    code: "created",
    message: "Your merchant referral link is ready.",
  };
}

export async function setMerchantReferralLinkEnabled(
  _previousState: ReferralOwnerActionResult | null,
  formData: FormData,
): Promise<ReferralOwnerActionResult> {
  const input = toggleInputSchema.safeParse({
    market: singleFormValue(formData, "market"),
    linkId: singleFormValue(formData, "link_id"),
    enabled: singleFormValue(formData, "enabled"),
  });
  if (!input.success) {
    return failure(
      "validation",
      "We could not verify this referral-link change.",
    );
  }

  const context = await getOwnerContext(input.data.market);
  if (!context.ok) return context.result;

  // The link ID and route market are untrusted form values. Re-read the
  // caller's strict owner projection before allowing an exact-market change.
  const current = await listMyReferralLinks(context.client).catch(() => ({
    links: [],
    error: true,
  }));
  if (
    current.error ||
    !current.links.some(
      (link) =>
        link.linkId === input.data.linkId && link.marketId === context.marketId,
    )
  ) {
    return failure(
      "validation",
      "This referral link cannot be changed from the selected market.",
    );
  }

  const result = await setMyReferralLinkEnabled(context.client, {
    linkId: input.data.linkId,
    enabled: input.data.enabled,
  }).catch(() => ({ link: null, error: true }));
  if (
    result.error ||
    !result.link ||
    result.link.linkId !== input.data.linkId ||
    result.link.marketId !== context.marketId ||
    result.link.status !== (input.data.enabled ? "active" : "disabled")
  ) {
    return failure(
      "unavailable",
      "We could not confirm this referral-link change. Try again later.",
    );
  }

  revalidatePath(`/${input.data.market}/refer/merchant`);
  return {
    ok: true,
    code: "updated",
    message: input.data.enabled
      ? "Your merchant referral link is enabled."
      : "Your merchant referral link is disabled.",
  };
}
