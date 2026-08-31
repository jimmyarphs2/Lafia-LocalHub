import { redirect } from "next/navigation";

import { OrderRecordListItem } from "@/components/orders/order-record";
import { listVendorOrders } from "@/lib/orders/rpc";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function VendorOrdersPage() {
  const client = await getServerSupabaseClient();
  const user =
    client && (await client.auth.getUser().catch(() => null))?.data.user;
  if (!client || !user) redirect("/auth?next=%2Fvendor%2Forders");

  const result = await listVendorOrders(client).catch(() => ({
    orders: [],
    error: true,
  }));
  const orders = result.error ? [] : result.orders;

  return (
    <section
      className="container section"
      aria-labelledby="vendor-orders-title"
    >
      <p className="eyebrow">Vendor order inbox</p>
      <h1 id="vendor-orders-title">Orders placed for your listings</h1>
      <p>
        Placed orders are awaiting your availability decision. Open an order to
        confirm availability or cancel before payment; no payment has been
        collected through LocalHub.
      </p>
      {result.error ? (
        <p role="alert">Orders are temporarily unavailable.</p>
      ) : null}
      {!result.error && orders.length === 0 ? (
        <p>No orders have been placed for your listings yet.</p>
      ) : null}
      <ul className="info-list" aria-label="Orders for your listings">
        {orders.map((order) => (
          <OrderRecordListItem
            href={"/vendor/orders/" + order.orderNumber}
            key={order.id}
            order={order}
            showVendorName
          />
        ))}
      </ul>
    </section>
  );
}
