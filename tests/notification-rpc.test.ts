import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  listMyInAppNotifications,
  markMyInAppNotificationRead,
} from "@/lib/notifications/rpc";

const ids = {
  notification: "11111111-1111-4111-8111-111111111111",
  notificationTwo: "11111111-1111-4111-8111-111111111112",
  market: "22222222-2222-4222-8222-222222222222",
  foreignMarket: "33333333-3333-4333-8333-333333333333",
};
const createdAt = "2026-08-31T10:00:00.000001Z";
const beforeAt = "2026-08-31T11:00:00.000001Z";
const readAt = "2026-08-31T10:05:00.000001Z";

const rpc = vi.fn();
const client = { rpc } as never;

function row(overrides: Record<string, unknown> = {}) {
  return {
    notification_id: ids.notification,
    market_id: ids.market,
    template_key: "order_status_changed",
    template_version: 1,
    title: "Your order is confirmed",
    body: "The vendor has confirmed your order.",
    action_path: "/lafia/orders/LO-260830-0000000001",
    read_at: null,
    created_at: createdAt,
    ...overrides,
  };
}

function listInput(overrides: Record<string, unknown> = {}) {
  return {
    marketId: ids.market,
    limit: 20,
    cursor: null,
    unreadOnly: false,
    ...overrides,
  };
}

beforeEach(() => {
  rpc.mockReset();
});

describe("in-app notification list RPC adapter", () => {
  it("calls only the bounded user-session RPC and never sends a route market", async () => {
    rpc.mockResolvedValue({ data: [row()], error: null });

    await expect(
      listMyInAppNotifications(client, listInput()),
    ).resolves.toEqual({
      notifications: [
        {
          notificationId: ids.notification,
          marketId: ids.market,
          templateKey: "order_status_changed",
          templateVersion: 1,
          title: "Your order is confirmed",
          body: "The vendor has confirmed your order.",
          actionPath: "/lafia/orders/LO-260830-0000000001",
          readAt: null,
          createdAt,
        },
      ],
      error: null,
    });
    expect(rpc).toHaveBeenCalledWith("list_my_notifications", {
      p_limit: 20,
      p_unread_only: false,
    });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_market_slug");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_market_id");
  });

  it("passes a complete keyset cursor and unread filter with exact argument names", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await expect(
      listMyInAppNotifications(
        client,
        listInput({
          limit: 50,
          unreadOnly: true,
          cursor: {
            createdAt: beforeAt,
            notificationId: ids.notificationTwo,
          },
        }),
      ),
    ).resolves.toEqual({ notifications: [], error: null });
    expect(rpc).toHaveBeenCalledWith("list_my_notifications", {
      p_limit: 50,
      p_before_created_at: beforeAt,
      p_before_id: ids.notificationTwo,
      p_unread_only: true,
    });
  });

  it("rejects malformed inputs before touching the database", async () => {
    for (const input of [
      listInput({ marketId: "bad" }),
      listInput({ limit: 0 }),
      listInput({ limit: 51 }),
      listInput({ limit: 1.5 }),
      listInput({ unreadOnly: "true" }),
      listInput({ cursor: { createdAt: beforeAt } }),
      listInput({
        cursor: { createdAt: "tomorrow", notificationId: ids.notification },
      }),
      listInput({
        cursor: { createdAt: beforeAt, notificationId: "bad" },
      }),
      { ...listInput(), injected: "value" },
    ]) {
      const result = await listMyInAppNotifications(client, input as never);
      expect(result.notifications).toBeNull();
      expect(result.error).toBeTruthy();
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed on provider rejects, provider errors, contract drift, or duplicates", async () => {
    const responses = [
      { data: row(), error: null },
      { data: [row({ payload: { secret: true } })], error: null },
      { data: [row(), row()], error: null },
      { data: [row()], error: new Error("provider detail") },
    ];

    for (const response of responses) {
      rpc.mockResolvedValueOnce(response);
      const result = await listMyInAppNotifications(client, listInput());
      expect(result.notifications).toBeNull();
      expect(result.error).toBeTruthy();
    }

    rpc.mockRejectedValueOnce(new Error("network detail"));
    const rejected = await listMyInAppNotifications(client, listInput());
    expect(rejected.notifications).toBeNull();
    expect(rejected.error).toBeTruthy();
  });

  it("partitions valid other-market rows and verifies unread-only output", async () => {
    rpc.mockResolvedValueOnce({
      data: [row({ market_id: ids.foreignMarket })],
      error: null,
    });
    await expect(
      listMyInAppNotifications(client, listInput()),
    ).resolves.toEqual({ notifications: [], error: null });

    rpc.mockResolvedValueOnce({
      data: [row({ read_at: readAt })],
      error: null,
    });
    const drifted = await listMyInAppNotifications(
      client,
      listInput({ unreadOnly: true }),
    );
    expect(drifted.notifications).toBeNull();
    expect(drifted.error?.kind).toBe("contract");
  });
});

describe("mark-read RPC adapter", () => {
  it("uses the sole notification identifier and accepts only a strict singleton result", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "marked_read",
          notification_id: ids.notification,
          read_at: readAt,
        },
      ],
      error: null,
    });

    await expect(
      markMyInAppNotificationRead(client, ids.notification),
    ).resolves.toEqual({
      result: {
        outcome: "marked_read",
        notificationId: ids.notification,
        readAt,
      },
      error: null,
    });
    expect(rpc).toHaveBeenCalledWith("mark_my_notification_read", {
      p_notification_id: ids.notification,
    });
  });

  it("accepts idempotent replay and indistinguishable not-found outcomes", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          outcome: "already_read",
          notification_id: ids.notification,
          read_at: readAt,
        },
      ],
      error: null,
    });
    await expect(
      markMyInAppNotificationRead(client, ids.notification),
    ).resolves.toMatchObject({
      result: { outcome: "already_read", readAt },
      error: null,
    });

    rpc.mockResolvedValueOnce({
      data: [{ outcome: "not_found", notification_id: null, read_at: null }],
      error: null,
    });
    await expect(
      markMyInAppNotificationRead(client, ids.notificationTwo),
    ).resolves.toEqual({
      result: {
        outcome: "not_found",
        notificationId: null,
        readAt: null,
      },
      error: null,
    });
  });

  it("rejects malformed identifiers and malformed or mismatched results", async () => {
    const invalidInput = await markMyInAppNotificationRead(client, "bad");
    expect(invalidInput.result).toBeNull();
    expect(invalidInput.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();

    for (const response of [
      { data: [], error: null },
      {
        data: [
          {
            outcome: "garbage",
            notification_id: ids.notification,
            read_at: readAt,
          },
        ],
        error: null,
      },
      {
        data: [
          {
            outcome: "marked_read",
            notification_id: ids.notificationTwo,
            read_at: readAt,
          },
        ],
        error: null,
      },
      {
        data: [
          {
            outcome: "marked_read",
            notification_id: ids.notification,
            read_at: null,
          },
        ],
        error: null,
      },
      {
        data: [
          {
            outcome: "marked_read",
            notification_id: ids.notification,
            read_at: readAt,
          },
          {
            outcome: "already_read",
            notification_id: ids.notification,
            read_at: readAt,
          },
        ],
        error: null,
      },
      {
        data: [
          {
            outcome: "marked_read",
            notification_id: ids.notification,
            read_at: readAt,
          },
        ],
        error: new Error("provider"),
      },
    ]) {
      rpc.mockResolvedValueOnce(response);
      const result = await markMyInAppNotificationRead(
        client,
        ids.notification,
      );
      expect(result.result).toBeNull();
      expect(result.error).toBeTruthy();
    }

    rpc.mockRejectedValueOnce(new Error("network"));
    const rejected = await markMyInAppNotificationRead(
      client,
      ids.notification,
    );
    expect(rejected.result).toBeNull();
    expect(rejected.error).toBeTruthy();
  });
});
