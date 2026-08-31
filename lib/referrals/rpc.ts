import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parseReferralAcquisitionLink,
  parseReferralAcquisitionLinkList,
  parseReferralAcquisitionResolution,
  parseReferrerIdentity,
  referralCodeSchema,
  referralIdSchema,
  type ReferralAcquisitionLink,
  type ReferralAcquisitionResolution,
  type ReferrerIdentity,
} from "@/lib/referrals/contract";
import type { Database } from "@/lib/supabase/database.types";

type ReferralClient = SupabaseClient<Database>;

export type ReferralRpcFailure =
  { kind: "provider"; cause: unknown } | { kind: "contract"; cause: Error };

type RpcResponse = { data: unknown; error: unknown };

function contractFailure(operation: string): ReferralRpcFailure {
  return {
    kind: "contract",
    cause: new Error(
      `${operation} response did not match its bounded referral contract.`,
    ),
  };
}

function singleRpcRow(value: unknown): unknown | null {
  return Array.isArray(value) && value.length === 1 ? value[0] : null;
}

async function parsedRpc<T>(
  operation: string,
  request: () => PromiseLike<RpcResponse>,
  parse: (value: unknown) => T | null,
): Promise<{ value: T | null; error: ReferralRpcFailure | null }> {
  let result: RpcResponse;
  try {
    result = await request();
  } catch (cause) {
    return { value: null, error: { kind: "provider", cause } };
  }
  if (result.error !== null && result.error !== undefined) {
    return {
      value: null,
      error: { kind: "provider", cause: result.error },
    };
  }
  const value = parse(result.data);
  return value === null
    ? { value: null, error: contractFailure(operation) }
    : { value, error: null };
}

export async function ensureMyReferrerIdentity(
  client: ReferralClient,
): Promise<{
  identity: ReferrerIdentity | null;
  error: ReferralRpcFailure | null;
}> {
  const result = await parsedRpc(
    "ensure_my_referrer_identity",
    () => client.rpc("ensure_my_referrer_identity"),
    (value) => parseReferrerIdentity(singleRpcRow(value)),
  );
  return { identity: result.value, error: result.error };
}

export async function createOrGetMyReferralLink(
  client: ReferralClient,
  marketId: string,
): Promise<{
  link: ReferralAcquisitionLink | null;
  error: ReferralRpcFailure | null;
}> {
  if (!referralIdSchema.safeParse(marketId).success) {
    return {
      link: null,
      error: contractFailure("create_or_get_my_referral_link input"),
    };
  }
  const result = await parsedRpc(
    "create_or_get_my_referral_link",
    () =>
      client.rpc("create_or_get_my_referral_link", {
        p_market_id: marketId,
      }),
    (value) => parseReferralAcquisitionLink(singleRpcRow(value)),
  );
  return { link: result.value, error: result.error };
}

export async function listMyReferralLinks(client: ReferralClient): Promise<{
  links: ReferralAcquisitionLink[];
  error: ReferralRpcFailure | null;
}> {
  const result = await parsedRpc(
    "list_my_referral_links",
    () => client.rpc("list_my_referral_links"),
    parseReferralAcquisitionLinkList,
  );
  return { links: result.value ?? [], error: result.error };
}

export async function setMyReferralLinkEnabled(
  client: ReferralClient,
  input: { linkId: string; enabled: boolean },
): Promise<{
  link: ReferralAcquisitionLink | null;
  error: ReferralRpcFailure | null;
}> {
  if (
    !referralIdSchema.safeParse(input.linkId).success ||
    typeof input.enabled !== "boolean"
  ) {
    return {
      link: null,
      error: contractFailure("set_my_referral_link_enabled input"),
    };
  }
  const result = await parsedRpc(
    "set_my_referral_link_enabled",
    () =>
      client.rpc("set_my_referral_link_enabled", {
        p_link_id: input.linkId,
        p_enabled: input.enabled,
      }),
    (value) => parseReferralAcquisitionLink(singleRpcRow(value)),
  );
  return { link: result.value, error: result.error };
}

export async function resolveReferralAcquisitionLink(
  client: ReferralClient,
  code: string,
): Promise<{
  resolution: ReferralAcquisitionResolution | null;
  error: ReferralRpcFailure | null;
}> {
  if (!referralCodeSchema.safeParse(code).success) {
    return {
      resolution: null,
      error: contractFailure("resolve_referral_acquisition_link input"),
    };
  }
  const result = await parsedRpc(
    "resolve_referral_acquisition_link",
    () => client.rpc("resolve_referral_acquisition_link", { p_code: code }),
    (value) => parseReferralAcquisitionResolution(singleRpcRow(value)),
  );
  return { resolution: result.value, error: result.error };
}
