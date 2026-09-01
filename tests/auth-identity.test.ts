import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readAuthIdentity } from "@/lib/auth/identity";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function makeClient({
  user = {
    id: USER_ID,
    email: "ada@example.com",
    user_metadata: {
      full_name: "Ada Okafor",
      avatar_url: "https://lh3.googleusercontent.com/a/photo",
    },
  },
  profile = {
    data: {
      display_name: "Ada O.",
      avatar_path: null,
      is_suspended: false,
    },
    error: null,
  },
  memberships = { data: [], error: null },
}: {
  user?: Record<string, unknown> | null;
  profile?: { data: unknown; error: unknown };
  memberships?: { data: unknown; error: unknown };
} = {}) {
  const from = vi.fn((table: string) => {
    if (table === "profiles") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => profile }),
        }),
      };
    }

    if (table === "business_memberships") {
      return {
        select: () => ({
          eq: () => ({
            not: () => ({
              order: () => ({ limit: async () => memberships }),
            }),
          }),
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    client: {
      auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
      from,
    },
    from,
  };
}

describe("authenticated LocalHub identity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null for a guest without reading private profile tables", async () => {
    const { client, from } = makeClient({ user: null });

    await expect(readAuthIdentity(client as never)).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("uses the returning customer's profile and trustworthy Google avatar", async () => {
    const { client } = makeClient();

    await expect(readAuthIdentity(client as never)).resolves.toMatchObject({
      userId: USER_ID,
      displayName: "Ada O.",
      email: "ada@example.com",
      avatarUrl: "https://lh3.googleusercontent.com/a/photo",
      profileExists: true,
      accessState: "active",
      suspended: false,
      role: "customer",
      business: null,
    });
  });

  it("falls back to bounded auth metadata when first-user profile reads lag", async () => {
    const { client } = makeClient({
      profile: { data: null, error: { message: "temporarily unavailable" } },
    });

    await expect(readAuthIdentity(client as never)).resolves.toMatchObject({
      displayName: "Ada Okafor",
      profileExists: false,
      accessState: "unavailable",
      role: "customer",
    });
  });

  it("derives vendor identity only from an accepted membership", async () => {
    const { client } = makeClient({
      memberships: {
        data: [
          {
            business_id: "22222222-2222-4222-8222-222222222222",
            role: "manager",
            businesses: {
              id: "22222222-2222-4222-8222-222222222222",
              name: "Amina Foods",
              status: "active",
            },
          },
        ],
        error: null,
      },
    });

    await expect(readAuthIdentity(client as never)).resolves.toMatchObject({
      accessState: "active",
      role: "vendor",
      business: {
        name: "Amina Foods",
        memberRole: "manager",
        canManageListings: true,
      },
    });
  });

  it("fails closed to customer navigation for a suspended profile", async () => {
    const { client } = makeClient({
      profile: {
        data: {
          display_name: "Ada O.",
          avatar_path: null,
          is_suspended: true,
        },
        error: null,
      },
      memberships: {
        data: [
          {
            business_id: "22222222-2222-4222-8222-222222222222",
            role: "owner",
            businesses: {
              id: "22222222-2222-4222-8222-222222222222",
              name: "Amina Foods",
              status: "active",
            },
          },
        ],
        error: null,
      },
    });

    const identity = await readAuthIdentity(client as never);
    expect(identity).toMatchObject({
      accessState: "suspended",
      suspended: true,
      role: "customer",
    });
    expect(identity?.business).toBeNull();
  });

  it("rejects untrusted or non-HTTPS avatar metadata", async () => {
    const { client } = makeClient({
      user: {
        id: USER_ID,
        email: "ada@example.com",
        user_metadata: {
          name: "Ada",
          picture: "http://attacker.example/avatar.png",
        },
      },
    });

    expect((await readAuthIdentity(client as never))?.avatarUrl).toBeNull();
  });

  it("never derives vendor authorization from provider metadata", async () => {
    const { client } = makeClient({
      user: {
        id: USER_ID,
        email: "ada@example.com",
        user_metadata: { name: "Ada", role: "vendor", merchant: true },
      },
      memberships: { data: [], error: null },
    });

    await expect(readAuthIdentity(client as never)).resolves.toMatchObject({
      accessState: "active",
      role: "customer",
      business: null,
    });
  });

  it("rejects a malformed or foreign joined business", async () => {
    const { client } = makeClient({
      memberships: {
        data: [
          {
            business_id: "22222222-2222-4222-8222-222222222222",
            role: "owner",
            businesses: {
              id: "33333333-3333-4333-8333-333333333333",
              name: "Foreign business",
              status: "active",
            },
          },
        ],
        error: null,
      },
    });

    await expect(readAuthIdentity(client as never)).resolves.toMatchObject({
      accessState: "unavailable",
      role: "customer",
      business: null,
    });
  });

  it("does not grant vendor navigation for a suspended business", async () => {
    const { client } = makeClient({
      memberships: {
        data: [
          {
            business_id: "22222222-2222-4222-8222-222222222222",
            role: "owner",
            businesses: {
              id: "22222222-2222-4222-8222-222222222222",
              name: "Amina Foods",
              status: "suspended",
            },
          },
        ],
        error: null,
      },
    });

    await expect(readAuthIdentity(client as never)).resolves.toMatchObject({
      accessState: "unavailable",
      role: "customer",
      business: null,
    });
  });

  it("does not grant vendor navigation while the own profile is unavailable", async () => {
    const { client } = makeClient({
      profile: { data: null, error: null },
      memberships: {
        data: [
          {
            business_id: "22222222-2222-4222-8222-222222222222",
            role: "owner",
            businesses: {
              id: "22222222-2222-4222-8222-222222222222",
              name: "Amina Foods",
              status: "active",
            },
          },
        ],
        error: null,
      },
    });

    await expect(readAuthIdentity(client as never)).resolves.toMatchObject({
      profileExists: false,
      accessState: "unavailable",
      role: "customer",
      business: null,
    });
  });

  it("keeps a confirmed active profile restricted when membership reads fail", async () => {
    const { client } = makeClient({
      memberships: { data: null, error: { message: "offline" } },
    });

    await expect(readAuthIdentity(client as never)).resolves.toMatchObject({
      profileExists: true,
      accessState: "unavailable",
      suspended: false,
      role: "customer",
      business: null,
    });
  });
});
