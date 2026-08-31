import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  getClient: vi.fn(),
  getMarket: vi.fn(),
  getUser: vi.fn(),
  list: vi.fn(),
  mark: vi.fn(),
  revalidatePath: vi.fn(),
  select: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: mocks.getClient,
}));
vi.mock("@/lib/notifications/rpc", () => ({
  listMyInAppNotifications: mocks.list,
  markMyInAppNotificationRead: mocks.mark,
}));

import { markNotificationRead } from "@/app/[market]/activity/actions";

const ids = {
  notification: "11111111-1111-4111-8111-111111111111",
  notificationTwo: "11111111-1111-4111-8111-111111111112",
  market: "22222222-2222-4222-8222-222222222222",
  foreignMarket: "33333333-3333-4333-8333-333333333333",
};
const createdAt = "2026-08-31T10:00:00.000001Z";
const readAt = "2026-08-31T10:05:00.000001Z";

function notification(overrides: Record<string, unknown> = {}) {
  return {
    notificationId: ids.notification,
    marketId: ids.market,
    templateKey: "order_status_changed",
    templateVersion: 1,
    title: "Your order is confirmed",
    body: "The vendor has confirmed your order.",
    actionPath: "/lafia/orders/LO-260830-0000000001",
    readAt: null,
    createdAt,
    ...overrides,
  };
}

function query() {
  const builder = {
    eq: mocks.eq,
    maybeSingle: mocks.getMarket,
    select: mocks.select,
  };
  mocks.select.mockReturnValue(builder);
  mocks.eq.mockReturnValue(builder);
  return builder;
}

function client() {
  return {
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.active,
  };
}

function form(values: Record<string, string | readonly string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      data.append(key, item);
    }
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "customer" } },
    error: null,
  });
  mocks.active.mockResolvedValue({ data: true, error: null });
  mocks.getMarket.mockResolvedValue({
    data: { id: ids.market, slug: "lafia" },
    error: null,
  });
  mocks.from.mockReturnValue(query());
  mocks.getClient.mockResolvedValue(client());
  mocks.list.mockResolvedValue({
    notifications: [notification()],
    error: null,
  });
  mocks.mark.mockResolvedValue({
    result: {
      outcome: "marked_read",
      notificationId: ids.notification,
      readAt,
    },
    error: null,
  });
});

describe("mark notification read server action", () => {
  it("rejects malformed, missing, unknown, or duplicate form values before client access", async () => {
    const invalidForms: Record<string, string | readonly string[]>[] = [
      { market: "Lafia", notification_id: ids.notification },
      { market: "lafia", notification_id: "bad" },
      { market: ["lafia", "abuja"], notification_id: ids.notification },
      {
        market: "lafia",
        notification_id: [ids.notification, ids.notificationTwo],
      },
      { market: "lafia", notification_id: ids.notification, injected: "x" },
    ];
    for (const values of invalidForms) {
      await expect(
        markNotificationRead(null, form(values)),
      ).resolves.toMatchObject({ ok: false, code: "validation" });
    }
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.mark).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("reauthenticates and requires an exact active profile", async () => {
    mocks.getClient.mockResolvedValueOnce(null);
    await expect(
      markNotificationRead(
        null,
        form({ market: "lafia", notification_id: ids.notification }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "unauthorized" });
    expect(mocks.mark).not.toHaveBeenCalled();

    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(
      markNotificationRead(
        null,
        form({ market: "lafia", notification_id: ids.notification }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "unauthorized" });
    expect(mocks.mark).not.toHaveBeenCalled();

    mocks.active.mockResolvedValueOnce({ data: false, error: null });
    await expect(
      markNotificationRead(
        null,
        form({ market: "lafia", notification_id: ids.notification }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "unauthorized" });
    expect(mocks.mark).not.toHaveBeenCalled();
  });

  it("requires the exact canonical active market before notification reads", async () => {
    for (const marketResponse of [
      { data: null, error: null },
      { data: { id: ids.market, slug: "abuja" }, error: null },
      { data: { id: ids.market, slug: "lafia" }, error: new Error("db") },
    ]) {
      mocks.getMarket.mockResolvedValueOnce(marketResponse);
      await expect(
        markNotificationRead(
          null,
          form({ market: "lafia", notification_id: ids.notification }),
        ),
      ).resolves.toMatchObject({ ok: false });
      expect(mocks.list).not.toHaveBeenCalled();
      expect(mocks.mark).not.toHaveBeenCalled();
    }
    expect(mocks.from).toHaveBeenCalledWith("markets");
    expect(mocks.eq).toHaveBeenCalledWith("slug", "lafia");
    expect(mocks.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("proves exact-market or platform-wide visibility before marking", async () => {
    const actionForm = form({
      market: "lafia",
      notification_id: ids.notification,
    });
    await expect(markNotificationRead(null, actionForm)).resolves.toMatchObject(
      { ok: true, code: "marked_read" },
    );
    expect(mocks.list).toHaveBeenCalledWith(expect.anything(), {
      marketId: ids.market,
      limit: 50,
      cursor: null,
      unreadOnly: false,
    });
    expect(mocks.mark).toHaveBeenCalledWith(
      expect.anything(),
      ids.notification,
    );

    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "customer" } },
      error: null,
    });
    mocks.active.mockResolvedValue({ data: true, error: null });
    mocks.getMarket.mockResolvedValue({
      data: { id: ids.market, slug: "lafia" },
      error: null,
    });
    mocks.from.mockReturnValue(query());
    mocks.getClient.mockResolvedValue(client());
    mocks.list.mockResolvedValue({
      notifications: [notification({ marketId: null })],
      error: null,
    });
    mocks.mark.mockResolvedValue({
      result: {
        outcome: "marked_read",
        notificationId: ids.notification,
        readAt,
      },
      error: null,
    });
    await expect(
      markNotificationRead(
        null,
        form({ market: "lafia", notification_id: ids.notification }),
      ),
    ).resolves.toMatchObject({ ok: true, code: "marked_read" });
  });

  it("does not mark an absent, duplicate, or foreign-market notification", async () => {
    for (const notifications of [
      [],
      [notification({ notificationId: ids.notificationTwo })],
      [notification({ marketId: ids.foreignMarket })],
      [notification(), notification()],
    ]) {
      mocks.list.mockResolvedValueOnce({ notifications, error: null });
      await expect(
        markNotificationRead(
          null,
          form({ market: "lafia", notification_id: ids.notification }),
        ),
      ).resolves.toMatchObject({ ok: false });
      expect(mocks.mark).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    }
  });

  it("contains list and mark provider failures without mutation or revalidation", async () => {
    mocks.list.mockResolvedValueOnce({
      notifications: [notification()],
      error: new Error("provider detail"),
    });
    await expect(
      markNotificationRead(
        null,
        form({ market: "lafia", notification_id: ids.notification }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "unavailable",
      retryable: true,
    });
    expect(mocks.mark).not.toHaveBeenCalled();

    mocks.list.mockRejectedValueOnce(new Error("list network detail"));
    await expect(
      markNotificationRead(
        null,
        form({ market: "lafia", notification_id: ids.notification }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "unavailable" });

    mocks.mark.mockRejectedValueOnce(new Error("mark network detail"));
    await expect(
      markNotificationRead(
        null,
        form({ market: "lafia", notification_id: ids.notification }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "unavailable" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("revalidates only exact marked or replay results at a literal activity path", async () => {
    await expect(
      markNotificationRead(
        null,
        form({ market: "lafia", notification_id: ids.notification }),
      ),
    ).resolves.toMatchObject({ ok: true, code: "marked_read" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/lafia/activity");

    mocks.mark.mockResolvedValueOnce({
      result: {
        outcome: "already_read",
        notificationId: ids.notification,
        readAt,
      },
      error: null,
    });
    await expect(
      markNotificationRead(
        null,
        form({ market: "lafia", notification_id: ids.notification }),
      ),
    ).resolves.toMatchObject({ ok: true, code: "already_read" });

    mocks.revalidatePath.mockClear();
    for (const result of [
      { outcome: "not_found", notificationId: null, readAt: null },
      {
        outcome: "marked_read",
        notificationId: ids.notificationTwo,
        readAt,
      },
      {
        outcome: "garbage",
        notificationId: ids.notification,
        readAt,
      },
    ]) {
      mocks.mark.mockResolvedValueOnce({ result, error: null });
      await expect(
        markNotificationRead(
          null,
          form({ market: "lafia", notification_id: ids.notification }),
        ),
      ).resolves.toMatchObject({ ok: false });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    }
  });
});
