import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OrderRecordDetail } from "@/components/orders/order-record";
import { OrderDecisionControls } from "@/components/vendor/order-decision-controls";
import { OrderFulfilmentControls } from "@/components/vendor/order-fulfilment-controls";
import { orderNumberSchema } from "@/lib/orders/contract";
import { getVendorOrder } from "@/lib/orders/rpc";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function VendorOrderDetailPage({
  params,
}: {
  params: Promise<{ order: string }>;
}) {
  const { order: orderNumber } = await params;
  if (!orderNumberSchema.safeParse(orderNumber).success) notFound();

  const client = await getServerSupabaseClient();
  const user =
    client && (await client.auth.getUser().catch(() => null))?.data.user;
  if (!client || !user) {
    const returnTo = "/vendor/orders/" + orderNumber;
    redirect("/auth?next=" + encodeURIComponent(returnTo));
  }

  const result = await getVendorOrder(client, orderNumber).catch(() => ({
    order: null,
    error: true,
  }));
  if (result.error) {
    return (
      <div className="container section" aria-labelledby="order-error-title">
        <p className="eyebrow">Vendor order tracking</p>
        <h1 id="order-error-title">Order temporarily unavailable</h1>
        <p role="alert">
          We could not load this order. Please try again later.
        </p>
        <Link className="text-link" href="/vendor/orders">
          Back to order inbox
        </Link>
      </div>
    );
  }
  if (!result.order || result.order.orderNumber !== orderNumber) notFound();

  return (
    <div className="container section">
      <p className="breadcrumbs">
        <Link href="/vendor/orders">Order inbox</Link> /{" "}
        {result.order.orderNumber}
      </p>
      <OrderRecordDetail
        headingId="vendor-order-tracking-title"
        order={result.order}
        showVendorName
      />
      <OrderDecisionControls
        initialIdempotencyKey={crypto.randomUUID()}
        orderId={result.order.id}
        status={result.order.status}
      />
      <OrderFulfilmentControls
        fulfilment={result.order.fulfilment}
        initialIdempotencyKey={crypto.randomUUID()}
        orderId={result.order.id}
        status={result.order.status}
      />
      <p>
        <Link
          className="text-link"
          href={
            "/" +
            result.order.marketSlug +
            "/listings/" +
            result.order.listingRoute
          }
        >
          View listing
        </Link>
      </p>
    </div>
  );
}
