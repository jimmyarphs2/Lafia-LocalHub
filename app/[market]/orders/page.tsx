import { redirect } from "next/navigation";

import { OrderRecordListItem } from "@/components/orders/order-record";
import { listCustomerOrders } from "@/lib/orders/rpc";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CustomerOrdersPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market } = await params;
  const client = await getServerSupabaseClient();
  const user =
    client && (await client.auth.getUser().catch(() => null))?.data.user;
  if (!client || !user) {
    redirect("/auth?next=" + encodeURIComponent("/" + market + "/orders"));
  }

  const result = await listCustomerOrders(client, market).catch(() => ({
    orders: [],
    error: true,
  }));
  const hasMismatchedMarket = result.orders.some(
    (order) => order.marketSlug !== market,
  );
  const unavailable = Boolean(result.error) || hasMismatchedMarket;
  const orders = unavailable ? [] : result.orders;

  return (
    <section className="container section" aria-labelledby="orders-title">
      <p className="eyebrow">Customer order history</p>
      <h1 id="orders-title">Your orders</h1>
      <p>
        Track orders you placed in this market. A placed order is awaiting
        vendor confirmation, and no payment has been collected through LocalHub.
      </p>
      {unavailable ? (
        <p role="alert">
          Your orders are temporarily unavailable. Please try again later.
        </p>
      ) : null}
      {!unavailable && orders.length === 0 ? (
        <p>You have not placed any orders in this market yet.</p>
      ) : null}
      <ul className="info-list" aria-label="Your order history">
        {orders.map((order) => (
          <OrderRecordListItem
            href={"/" + market + "/orders/" + order.orderNumber}
            key={order.id}
            order={order}
            showVendorName
          />
        ))}
      </ul>
    </section>
  );
}
