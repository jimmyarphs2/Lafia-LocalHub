import Link from "next/link";
import { redirect } from "next/navigation";

import { OrderPlacementForm } from "@/components/order-placement-form";
import { formatOrderMoney, orderIntentIdSchema } from "@/lib/orders/contract";
import { getListingOrderIntent } from "@/lib/orders/rpc";
import { listingRouteSchema, marketSlugSchema } from "@/lib/requests/contract";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ListingOrderConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ market: string; listing: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ market, listing }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const parsedMarket = marketSlugSchema.safeParse(market);
  const parsedListing = listingRouteSchema.safeParse(listing);
  if (!parsedMarket.success || !parsedListing.success) redirect("/");
  const listingPath = `/${parsedMarket.data}/listings/${parsedListing.data}`;
  const parsedIntent = orderIntentIdSchema.safeParse(
    typeof query.intent === "string" ? query.intent : null,
  );
  if (!parsedIntent.success) redirect(`${listingPath}?order=unavailable`);

  const client = await getServerSupabaseClient().catch(() => null);
  const user =
    client && (await client.auth.getUser().catch(() => null))?.data.user;
  if (!client || !user) {
    redirect(
      `/auth?next=${encodeURIComponent(`${listingPath}/order?intent=${parsedIntent.data}`)}`,
    );
  }

  const result = await getListingOrderIntent(client, parsedIntent.data).catch(
    () => ({ context: null, error: true }),
  );
  const context = result.context;
  if (
    result.error ||
    !context ||
    context.id !== parsedIntent.data ||
    context.marketSlug !== parsedMarket.data ||
    context.listingRoute !== parsedListing.data ||
    context.returnTo !== `${listingPath}/order`
  ) {
    redirect(`${listingPath}?order=unavailable`);
  }
  if (context.existingOrderNumber) {
    redirect(`/${context.marketSlug}/orders/${context.existingOrderNumber}`);
  }

  return (
    <div
      className="container section"
      aria-labelledby="order-confirmation-title"
    >
      <p className="breadcrumbs">
        <Link href={listingPath}>Back to {context.listingTitle}</Link>
      </p>
      <section className="empty-state">
        <p className="eyebrow">Review your order</p>
        <h1 id="order-confirmation-title">Confirm order details</h1>
        <p>
          Review the server-confirmed amount for {context.listingTitle} from{" "}
          {context.vendorName}. Placing it records an order for vendor
          confirmation; it does not begin fulfilment. No payment has been
          collected.
        </p>
        <dl aria-label="Order summary">
          <dt>Listing</dt>
          <dd>{context.listingTitle}</dd>
          <dt>Vendor</dt>
          <dd>{context.vendorName}</dd>
          <dt>Quantity</dt>
          <dd>{context.quantity}</dd>
          <dt>Unit price</dt>
          <dd>
            {formatOrderMoney(context.unitPriceMinor, context.currencyCode)}
          </dd>
          <dt>Total</dt>
          <dd>{formatOrderMoney(context.totalMinor, context.currencyCode)}</dd>
        </dl>
        <OrderPlacementForm intentId={context.id} />
      </section>
    </div>
  );
}
