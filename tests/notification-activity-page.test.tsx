import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
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
  notFound: vi.fn(),
  redirect: vi.fn(),
  select: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: mocks.getClient,
}));
vi.mock("@/lib/notifications/rpc", () => ({
  listMyInAppNotifications: mocks.list,
  markMyInAppNotificationRead: mocks.mark,
}));
vi.mock("@/app/[market]/activity/notification-controls", () => ({
  NotificationReadControl: ({
    market,
    notificationId,
    readAt,
  }: {
    market: string;
    notificationId: string;
    readAt: string | null;
  }) => (
    <div
      data-notification-control={notificationId}
      data-market={market}
      data-read={readAt === null ? "unread" : "read"}
    >
      {readAt === null ? "Unread" : "Read"}
    </div>
  ),
}));

import ActivityPage from "@/app/[market]/activity/page";

const redirectSignal = new Error("NEXT_REDIRECT");
const notFoundSignal = new Error("NEXT_NOT_FOUND");
const ids = {
  notification: "11111111-1111-4111-8111-111111111111",
  notificationTwo: "11111111-1111-4111-8111-111111111112",
  market: "22222222-2222-4222-8222-222222222222",
  foreignMarket: "33333333-3333-4333-8333-333333333333",
};
const createdAt = "2026-08-31T10:00:00.000001Z";
const earlierAt = "2026-08-31T09:00:00.000001Z";
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

function page(market = "lafia") {
  return ActivityPage({ params: Promise.resolve({ market }) } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => {
    throw redirectSignal;
  });
  mocks.notFound.mockImplementation(() => {
    throw notFoundSignal;
  });
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
  mocks.list.mockResolvedValue({ notifications: [], error: null });
});

describe("customer notification activity page", () => {
  it("rejects a malformed market before authentication or notification reads", async () => {
    await expect(page("Lafia")).rejects.toBe(notFoundSignal);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.mark).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated visitor to exact same-market recovery", async () => {
    mocks.getClient.mockResolvedValueOnce(null);

    await expect(page()).rejects.toBe(redirectSignal);
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/auth?next=%2Flafia%2Factivity",
    );
    expect(mocks.active).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("fails closed for an inactive profile or a non-canonical active market", async () => {
    mocks.active.mockResolvedValueOnce({ data: false, error: null });
    await expect(page()).rejects.toBe(notFoundSignal);
    expect(mocks.list).not.toHaveBeenCalled();

    mocks.active.mockResolvedValueOnce({ data: true, error: null });
    mocks.getMarket.mockResolvedValueOnce({
      data: { id: ids.market, slug: "abuja" },
      error: null,
    });
    await expect(page()).rejects.toBe(notFoundSignal);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("lists a bounded sanitized inbox for the exact active market without mutating", async () => {
    mocks.list.mockResolvedValueOnce({
      notifications: [
        notification(),
        notification({
          notificationId: ids.notificationTwo,
          marketId: null,
          title: "LocalHub service notice",
          body: "A platform-wide notice.",
          actionPath: null,
          readAt,
          createdAt: earlierAt,
        }),
      ],
      error: null,
    });

    const markup = renderToStaticMarkup(await page());

    expect(mocks.active).toHaveBeenCalledWith("is_current_profile_active");
    expect(mocks.from).toHaveBeenCalledWith("markets");
    expect(mocks.eq).toHaveBeenCalledWith("slug", "lafia");
    expect(mocks.eq).toHaveBeenCalledWith("is_active", true);
    expect(mocks.list).toHaveBeenCalledWith(expect.anything(), {
      marketId: ids.market,
      limit: 20,
      cursor: null,
      unreadOnly: false,
    });
    expect(mocks.mark).not.toHaveBeenCalled();
    expect(markup).toMatch(/<section[^>]+aria-labelledby="activity-title"/);
    expect(markup).toContain("<ol");
    expect(markup).toContain("<article");
    expect(markup).toMatch(/<h[2-3][^>]*>Your order is confirmed<\/h[2-3]>/);
    expect(markup).toContain(`<time dateTime="${createdAt}">`);
    expect(markup).toContain('href="/lafia/orders/LO-260830-0000000001"');
    expect(markup).toContain(`data-notification-control="${ids.notification}"`);
    expect(markup).toContain("LocalHub service notice");
    expect(markup).not.toMatch(/payload|profile_id|source_id|delivery_status/);
  });

  it("renders a useful empty state without a mark-read form", async () => {
    const markup = renderToStaticMarkup(await page());
    expect(markup).toMatch(/no notifications|nothing new/i);
    expect(markup).not.toContain("data-notification-control");
    expect(mocks.mark).not.toHaveBeenCalled();
  });

  it("contains provider, contract, and route-market drift without rendering unverified data", async () => {
    for (const result of [
      {
        notifications: [notification()],
        error: new Error("private provider detail"),
      },
      {
        notifications: [notification(), notification()],
        error: null,
      },
    ]) {
      mocks.list.mockResolvedValueOnce(result);
      const markup = renderToStaticMarkup(await page());
      expect(markup).toMatch(/temporarily unavailable|try again/i);
      expect(markup).not.toContain("Your order is confirmed");
      expect(markup).not.toContain("private provider detail");
      expect(mocks.mark).not.toHaveBeenCalled();
    }

    mocks.list.mockRejectedValueOnce(new Error("network secret"));
    const markup = renderToStaticMarkup(await page());
    expect(markup).toMatch(/temporarily unavailable|try again/i);
    expect(markup).not.toContain("network secret");
  });

  it("ignores valid notifications belonging to another market", async () => {
    mocks.list.mockResolvedValueOnce({
      notifications: [
        notification({
          marketId: ids.foreignMarket,
          title: "Foreign market update",
        }),
      ],
      error: null,
    });

    const markup = renderToStaticMarkup(await page());
    expect(markup).toMatch(/no notifications|nothing new/i);
    expect(markup).not.toContain("Foreign market update");
    expect(markup).not.toMatch(/temporarily unavailable|try again/i);
  });
});

describe("notification activity route boundaries", () => {
  it("keeps GET dynamic, noindex, read-only, and user-session only", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/[market]/activity/page.tsx"),
      "utf8",
    );
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toMatch(/robots:\s*\{\s*index:\s*false/i);
    expect(source).toContain("listMyInAppNotifications");
    expect(source).not.toMatch(
      /markMyInAppNotificationRead|markNotificationRead|\.update\(|supabase\/admin|service_role/,
    );
  });
});
