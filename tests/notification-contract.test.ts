import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_LIST_DEFAULT,
  NOTIFICATION_LIST_MAXIMUM,
  parseInAppNotificationList,
  parseNotificationMarkReadResult,
} from "@/lib/notifications/contract";

const ids = {
  notification: "11111111-1111-4111-8111-111111111111",
  notificationTwo: "11111111-1111-4111-8111-111111111112",
  market: "22222222-2222-4222-8222-222222222222",
  foreignMarket: "33333333-3333-4333-8333-333333333333",
};
const createdAt = "2026-08-31T10:00:00.000001Z";
const earlierAt = "2026-08-31T09:00:00.000001Z";
const readAt = "2026-08-31T10:05:00.000001Z";

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

const parseOptions = {
  marketId: ids.market,
  limit: NOTIFICATION_LIST_DEFAULT,
  cursor: null,
};

describe("in-app notification wire contract", () => {
  it("keeps the default list bounded below the database maximum", () => {
    expect(NOTIFICATION_LIST_DEFAULT).toBe(20);
    expect(NOTIFICATION_LIST_MAXIMUM).toBe(50);
  });

  it("accepts only the exact sanitized projection and preserves precise timestamps", () => {
    expect(parseInAppNotificationList([row()], parseOptions)).toEqual([
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
    ]);

    expect(
      parseInAppNotificationList(
        [row({ profile_id: "private-profile", payload: { phone: "+234" } })],
        parseOptions,
      ),
    ).toBeNull();
    expect(
      parseInAppNotificationList(
        [row({ delivery_status: "provider_accepted" })],
        parseOptions,
      ),
    ).toBeNull();
  });

  it("partitions platform-wide and exact-market rows without treating other markets as drift", () => {
    expect(
      parseInAppNotificationList(
        [
          row({ market_id: null }),
          row({
            notification_id: ids.notificationTwo,
            created_at: earlierAt,
          }),
        ],
        parseOptions,
      ),
    ).toHaveLength(2);

    expect(
      parseInAppNotificationList(
        [row({ market_id: ids.foreignMarket })],
        parseOptions,
      ),
    ).toEqual([]);
  });

  it("rejects malformed, oversized, duplicate, and unstable result sets", () => {
    const malformed = [
      row(),
      [row({ notification_id: "not-a-uuid" })],
      [row({ market_id: "not-a-uuid" })],
      [row({ template_key: "Mixed Case" })],
      [row({ template_version: 2 })],
      [row({ title: "" })],
      [row({ body: "unsafe\u0000body" })],
      [row({ read_at: "tomorrow" })],
      [row({ created_at: "2026-08-31" })],
      [row({ action_path: 42 })],
      [row({ action_path: "/" })],
      [row(), row()],
      Array.from({ length: NOTIFICATION_LIST_DEFAULT + 1 }, (_, index) =>
        row({
          notification_id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
        }),
      ),
      [
        row({ created_at: earlierAt }),
        row({
          notification_id: ids.notificationTwo,
          created_at: createdAt,
        }),
      ],
    ];

    for (const value of malformed) {
      expect(parseInAppNotificationList(value, parseOptions)).toBeNull();
    }
  });

  it("accepts only simple relative internal action paths", () => {
    for (const actionPath of [
      "https://attacker.example/steal",
      "//attacker.example/steal",
      "/lafia/orders/LO-260830-0000000001?next=//attacker.example",
      "/lafia/orders/LO-260830-0000000001#secret",
      "/lafia/%2e%2e/admin",
      "/lafia/../admin",
      "/lafia\\orders\\LO-260830-0000000001",
      "/Lafia/orders/LO-260830-0000000001",
      "/lafia//orders",
      "/lafia/ orders",
      "/lafia/\norders",
    ]) {
      expect(
        parseInAppNotificationList([row({ action_path: actionPath })], {
          ...parseOptions,
        }),
      ).toBeNull();
    }

    expect(
      parseInAppNotificationList([row({ action_path: null })], parseOptions),
    ).not.toBeNull();
  });

  it("requires a complete valid cursor and rows strictly after that keyset boundary", () => {
    const cursor = {
      createdAt,
      notificationId: ids.notification,
    };
    expect(
      parseInAppNotificationList(
        [
          row({
            notification_id: ids.notificationTwo,
            created_at: earlierAt,
          }),
        ],
        { ...parseOptions, cursor },
      ),
    ).not.toBeNull();
    expect(
      parseInAppNotificationList([row()], { ...parseOptions, cursor }),
    ).toBeNull();

    for (const invalidOptions of [
      { ...parseOptions, limit: 0 },
      { ...parseOptions, limit: 51 },
      { ...parseOptions, limit: 1.5 },
      { ...parseOptions, marketId: "bad" },
      {
        ...parseOptions,
        cursor: { createdAt: "tomorrow", notificationId: ids.notification },
      },
      {
        ...parseOptions,
        cursor: { createdAt, notificationId: "bad" },
      },
      { ...parseOptions, cursor: { createdAt } },
    ]) {
      expect(
        parseInAppNotificationList([], invalidOptions as never),
      ).toBeNull();
    }
  });

  it("preserves PostgreSQL microsecond ordering and cursor precision", () => {
    const laterMicrosecond = "2026-08-31T10:00:00.000002Z";
    expect(
      parseInAppNotificationList(
        [
          row({ created_at: laterMicrosecond }),
          row({
            notification_id: ids.notificationTwo,
            created_at: createdAt,
          }),
        ],
        parseOptions,
      ),
    ).toHaveLength(2);
    expect(
      parseInAppNotificationList([row({ created_at: laterMicrosecond })], {
        ...parseOptions,
        cursor: {
          createdAt,
          notificationId: ids.notificationTwo,
        },
      }),
    ).toBeNull();
  });

  it("fails an unread-only projection closed when a read row is returned", () => {
    expect(
      parseInAppNotificationList([row({ read_at: readAt })], {
        ...parseOptions,
        unreadOnly: true,
      }),
    ).toBeNull();
  });
});

describe("mark-read result wire contract", () => {
  it("accepts exact marked and replay outcomes for the requested notification", () => {
    for (const outcome of ["marked_read", "already_read"] as const) {
      expect(
        parseNotificationMarkReadResult(
          [
            {
              outcome,
              notification_id: ids.notification,
              read_at: readAt,
            },
          ],
          ids.notification,
        ),
      ).toEqual({
        outcome,
        notificationId: ids.notification,
        readAt,
      });
    }
  });

  it("accepts only a null-identity singleton for not-found", () => {
    expect(
      parseNotificationMarkReadResult(
        [{ outcome: "not_found", notification_id: null, read_at: null }],
        ids.notification,
      ),
    ).toEqual({
      outcome: "not_found",
      notificationId: null,
      readAt: null,
    });

    for (const value of [
      [],
      {},
      [
        { outcome: "not_found", notification_id: null, read_at: null },
        { outcome: "not_found", notification_id: null, read_at: null },
      ],
      [
        {
          outcome: "not_found",
          notification_id: ids.notification,
          read_at: null,
        },
      ],
      [
        {
          outcome: "not_found",
          notification_id: null,
          read_at: readAt,
        },
      ],
      [
        {
          outcome: "garbage",
          notification_id: ids.notification,
          read_at: readAt,
        },
      ],
      [
        {
          outcome: "marked_read",
          notification_id: ids.notificationTwo,
          read_at: readAt,
        },
      ],
      [
        {
          outcome: "marked_read",
          notification_id: ids.notification,
          read_at: null,
        },
      ],
      [
        {
          outcome: "marked_read",
          notification_id: ids.notification,
          read_at: readAt,
          payload: { private: true },
        },
      ],
    ]) {
      expect(
        parseNotificationMarkReadResult(value, ids.notification),
      ).toBeNull();
    }
  });
});
