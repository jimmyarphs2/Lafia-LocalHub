import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OrderRecordDetail } from "@/components/orders/order-record";
import { orderNumberSchema } from "@/lib/orders/contract";
import { getCustomerOrder } from "@/lib/orders/rpc";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CustomerOrderDetailPage({
  params,
}: {
  params: Promise<{ market: string; order: string }>;
}) {
  const { market, order: orderNumber } = await params;
  if (!orderNumberSchema.safeParse(orderNumber).success) notFound();

  const client = await getServerSupabaseClient();
  const user =
    client && (await client.auth.getUser().catch(() => null))?.data.user;
  if (!client || !user) {
    const returnTo = "/" + market + "/orders/" + orderNumber;
    redirect("/auth?next=" + encodeURIComponent(returnTo));
  }

  const result = await getCustomerOrder(client, market, orderNumber).catch(
    () => ({ order: null, error: true }),
  );
  if (result.error) {
    return (
      <div className="container section" aria-labelledby="order-error-title">
        <p className="eyebrow">Order tracking</p>
        <h1 id="order-error-title">Order temporarily unavailable</h1>
        <p role="alert">
          We could not load this order. Please try again later.
        </p>
        <Link className="text-link" href={"/" + market + "/orders"}>
          Back to your orders
        </Link>
      </div>
    );
  }
  if (
    !result.order ||
    result.order.marketSlug !== market ||
    result.order.orderNumber !== orderNumber
  ) {
    notFound();
  }

  return (
    <div className="container section">
      <p className="breadcrumbs">
        <Link href={"/" + market + "/activity"}>Activity</Link> /{" "}
        <Link href={"/" + market + "/orders"}>Your orders</Link> /{" "}
        {result.order.orderNumber}
      </p>
      <OrderRecordDetail
        headingId="order-tracking-title"
        order={result.order}
        showVendorName
      />
      <p>
        <Link
          className="text-link"
          href={"/" + market + "/listings/" + result.order.listingRoute}
        >
          View listing
        </Link>
      </p>
    </div>
  );
}
