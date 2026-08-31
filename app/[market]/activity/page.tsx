import { ClipboardList, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { notificationIdSchema } from "@/lib/notifications/contract";
import { listMyInAppNotifications } from "@/lib/notifications/rpc";
import { marketSlugSchema } from "@/lib/requests/contract";
import { getServerSupabaseClient } from "@/lib/supabase/server";

import { NotificationReadControl } from "./notification-controls";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Activity | LocalHub",
  robots: { index: false, follow: false },
};

export default async function CustomerActivityPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const route = marketSlugSchema.safeParse((await params).market);
  if (!route.success) notFound();

  const client = await getServerSupabaseClient().catch(() => null);
  const user =
    client && (await client.auth.getUser().catch(() => null))?.data.user;
  if (!client || !user) {
    redirect(`/auth?next=${encodeURIComponent(`/${route.data}/activity`)}`);
  }

  const access = await Promise.all([
    client.rpc("is_current_profile_active"),
    client
      .from("markets")
      .select("id,slug")
      .eq("slug", route.data)
      .eq("is_active", true)
      .maybeSingle(),
  ]).catch(() => null);
  if (!access) notFound();

  const [profileResult, marketResult] = access;
  const marketId = notificationIdSchema.safeParse(marketResult.data?.id);
  if (
    profileResult.error ||
    profileResult.data !== true ||
    marketResult.error ||
    !marketId.success ||
    marketResult.data?.slug !== route.data
  ) {
    notFound();
  }

  // GET is deliberately read-only. The sole state transition is the POST-only
  // mark-read Server Action rendered by NotificationReadControl.
  const result = await listMyInAppNotifications(client, {
    marketId: marketId.data,
    limit: 20,
    cursor: null,
    unreadOnly: false,
  }).catch(() => ({ notifications: null, error: true }));
  const ids = new Set<string>();
  const hasDuplicateNotification = (result.notifications ?? []).some(
    (notification) => {
      if (ids.has(notification.notificationId)) return true;
      ids.add(notification.notificationId);
      return false;
    },
  );
  const unavailable =
    Boolean(result.error) ||
    result.notifications === null ||
    hasDuplicateNotification;
  const notifications = unavailable
    ? []
    : (result.notifications ?? []).filter(
        (notification) =>
          notification.marketId === null ||
          notification.marketId === marketId.data,
      );

  return (
    <section className="container section" aria-labelledby="activity-title">
      <p className="eyebrow">Customer activity</p>
      <h1 id="activity-title">Orders, requests, and notifications</h1>
      <p>
        Return to private activity for this market. LocalHub shows this page
        only after verifying your active account and market.
      </p>

      <h2>Your notifications</h2>
      <p>
        Recent in-app updates appear here. Email, SMS, push, and voice delivery
        are not active.
      </p>
      {unavailable ? (
        <p role="alert">
          Notifications are temporarily unavailable. Please try again later.
        </p>
      ) : null}
      {!unavailable && notifications.length === 0 ? (
        <p>You have no notifications yet.</p>
      ) : null}
      {!unavailable && notifications.length > 0 ? (
        <ol className="info-list" aria-label="Your notifications">
          {notifications.map((notification) => (
            <li key={notification.notificationId}>
              <article
                aria-labelledby={`notice-${notification.notificationId}`}
              >
                <h3 id={`notice-${notification.notificationId}`}>
                  {notification.title}
                </h3>
                <p>{notification.body}</p>
                <p>
                  <time dateTime={notification.createdAt}>
                    {new Intl.DateTimeFormat("en-NG", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Africa/Lagos",
                    }).format(new Date(notification.createdAt))}
                  </time>
                </p>
                {notification.actionPath ? (
                  <p>
                    <Link className="text-link" href={notification.actionPath}>
                      View update
                    </Link>
                  </p>
                ) : null}
                <NotificationReadControl
                  market={route.data}
                  notificationId={notification.notificationId}
                  readAt={notification.readAt}
                />
              </article>
            </li>
          ))}
        </ol>
      ) : null}

      <h2>Orders and requests</h2>
      <ul className="info-list" aria-label="Customer activity areas">
        <li>
          <ShoppingBag aria-hidden="true" size={20} />
          <span>
            <strong>Your orders</strong>
            <br />
            View placed orders that are awaiting vendor confirmation. No payment
            has been collected.
            <br />
            <Link className="text-link" href={`/${route.data}/orders`}>
              View order history
            </Link>
          </span>
        </li>
        <li>
          <ClipboardList aria-hidden="true" size={20} />
          <span>
            <strong>Your requests</strong>
            <br />
            Track enquiries and vendor responses separately from orders.
            <br />
            <Link className="text-link" href={`/${route.data}/requests`}>
              View request history
            </Link>
          </span>
        </li>
      </ul>
    </section>
  );
}
