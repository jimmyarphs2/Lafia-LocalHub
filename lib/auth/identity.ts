import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cache } from "react";
import { z } from "zod";

import type { Database } from "@/lib/supabase/database.types";
import { getServerSupabaseClient } from "@/lib/supabase/server";

type BusinessMemberRole = Database["public"]["Enums"]["business_member_role"];

export type AuthIdentity = {
  userId: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  profileExists: boolean;
  accessState: "active" | "suspended" | "unavailable";
  suspended: boolean;
  role: "customer" | "vendor";
  business: {
    id: string;
    name: string;
    memberRole: BusinessMemberRole;
    canManageListings: boolean;
  } | null;
};

type ProfileRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "display_name" | "avatar_path" | "is_suspended"
>;

const profileRowSchema: z.ZodType<ProfileRow> = z.object({
  display_name: z.string().nullable(),
  avatar_path: z.string().nullable(),
  is_suspended: z.boolean(),
});

const membershipBusinessSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(["draft", "pending_review", "active", "suspended"]),
});

const membershipRowSchema = z.object({
  business_id: z.string().uuid(),
  role: z.enum(["owner", "manager", "staff"]),
  businesses: z.union([
    membershipBusinessSchema,
    z.array(membershipBusinessSchema),
    z.null(),
  ]),
});

type MembershipRow = z.infer<typeof membershipRowSchema>;

function normalizedLabel(value: unknown, maximum = 80): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return normalized.slice(0, maximum);
}

function metadataValue(user: User, key: string): unknown {
  const metadata = user.user_metadata;
  return metadata && typeof metadata === "object" ? metadata[key] : null;
}

function safeGoogleAvatar(user: User): string | null {
  const candidate = normalizedLabel(
    metadataValue(user, "avatar_url") ?? metadataValue(user, "picture"),
    512,
  );
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    const trustedHost =
      host === "googleusercontent.com" ||
      host.endsWith(".googleusercontent.com");
    return url.protocol === "https:" && trustedHost ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeEmail(user: User): string | null {
  return normalizedLabel(user.email, 254);
}

function identityName(user: User, profile: ProfileRow | null): string {
  const email = safeEmail(user);
  return (
    normalizedLabel(profile?.display_name) ??
    normalizedLabel(metadataValue(user, "full_name")) ??
    normalizedLabel(metadataValue(user, "name")) ??
    normalizedLabel(email?.split("@")[0]) ??
    "LocalHub member"
  );
}

function acceptedBusiness(
  membership: MembershipRow | undefined,
): AuthIdentity["business"] {
  if (!membership || !["owner", "manager", "staff"].includes(membership.role)) {
    return null;
  }
  const joined = Array.isArray(membership.businesses)
    ? membership.businesses[0]
    : membership.businesses;
  const name = normalizedLabel(joined?.name);
  if (
    !joined ||
    joined.id !== membership.business_id ||
    !name ||
    !["draft", "pending_review", "active"].includes(joined.status)
  ) {
    return null;
  }

  return {
    id: joined.id,
    name,
    memberRole: membership.role,
    canManageListings:
      membership.role === "owner" || membership.role === "manager",
  };
}

/** Reads identity only through the caller's cookie-scoped client and existing RLS. */
export async function readAuthIdentity(
  client: SupabaseClient<Database>,
): Promise<AuthIdentity | null> {
  const auth = await client.auth.getUser().catch(() => null);
  const user = auth?.data.user;
  if (!user || auth.error) return null;

  const profilePromise = Promise.resolve(
    client
      .from("profiles")
      .select("display_name,avatar_path,is_suspended")
      .eq("id", user.id)
      .maybeSingle(),
  ).catch(() => null);
  const membershipPromise = Promise.resolve(
    client
      .from("business_memberships")
      .select("business_id,role,businesses!inner(id,name,status)")
      .eq("profile_id", user.id)
      .not("accepted_at", "is", null)
      .order("created_at", { ascending: true })
      .limit(10),
  ).catch(() => null);
  const [profileResult, membershipResult] = await Promise.all([
    profilePromise,
    membershipPromise,
  ]);

  const profileParse = profileRowSchema.safeParse(
    profileResult && !profileResult.error ? profileResult.data : null,
  );
  const membershipParse = z
    .array(membershipRowSchema)
    .safeParse(
      membershipResult && !membershipResult.error
        ? membershipResult.data
        : null,
    );
  const profile = profileParse.success ? profileParse.data : null;
  const memberships = membershipParse.success ? membershipParse.data : [];
  const acceptedBusinesses = memberships
    .map(acceptedBusiness)
    .filter((business): business is NonNullable<typeof business> =>
      Boolean(business),
    );
  const accessState: AuthIdentity["accessState"] = !profile
    ? "unavailable"
    : profile.is_suspended
      ? "suspended"
      : !membershipParse.success
        ? "unavailable"
        : memberships.length > 0 && acceptedBusinesses.length === 0
          ? "unavailable"
          : "active";
  const business =
    accessState === "active" ? (acceptedBusinesses[0] ?? null) : null;

  return {
    userId: user.id,
    displayName: identityName(user, profile),
    email: safeEmail(user),
    avatarUrl: safeGoogleAvatar(user),
    profileExists: Boolean(profile),
    accessState,
    suspended: accessState === "suspended",
    role: business ? "vendor" : "customer",
    business,
  };
}

/** React cache is request-scoped; authenticated identity is never persisted globally. */
export const getCurrentIdentity = cache(
  async (): Promise<AuthIdentity | null> => {
    const client = await getServerSupabaseClient().catch(() => null);
    if (!client) return null;
    return readAuthIdentity(client).catch(() => null);
  },
);
