import Link from "next/link";

import {
  formatOrderMoney,
  presentOrderFulfilment,
  presentOrderStatus,
  type ListingOrderRecord,
} from "@/lib/orders/contract";

function formatPlacedAt(value: string) {
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function OrderRecordListItem({
  href,
  order,
  showVendorName,
}: {
  href: string;
  order: ListingOrderRecord;
  showVendorName: boolean;
}) {
  const presentation = presentOrderStatus(order.status);
  const fulfilmentPresentation = order.fulfilment
    ? presentOrderFulfilment(order.fulfilment)
    : null;

  return (
    <li>
      <span>
        <strong>{order.listingTitle}</strong>
        {showVendorName ? " · " + order.vendorName : ""}
        <br />
        Order {order.orderNumber} · {presentation.title}
        <br />
        {order.quantity} ×{" "}
        {formatOrderMoney(order.unitPriceMinor, order.currencyCode)} · Total{" "}
        {formatOrderMoney(order.totalMinor, order.currencyCode)}
        <br />
        Placed{" "}
        <time dateTime={order.placedAt}>{formatPlacedAt(order.placedAt)}</time>
        {order.vendorDecidedAt ? (
          <>
            <br />
            Vendor decision{" "}
            <time dateTime={order.vendorDecidedAt}>
              {formatPlacedAt(order.vendorDecidedAt)}
            </time>
          </>
        ) : null}
        {order.fulfilment ? (
          <>
            <br />
            {fulfilmentPresentation?.title}
            <br />
            Processing started{" "}
            <time dateTime={order.fulfilment.startedAt}>
              {formatPlacedAt(order.fulfilment.startedAt)}
            </time>
          </>
        ) : null}
        <br />
        <span className="help">
          {fulfilmentPresentation?.description ?? presentation.description}
        </span>
      </span>
      <Link className="text-link" href={href}>
        View order
      </Link>
    </li>
  );
}

export function OrderRecordDetail({
  headingId,
  order,
  showVendorName,
}: {
  headingId: string;
  order: ListingOrderRecord;
  showVendorName: boolean;
}) {
  const presentation = presentOrderStatus(order.status);
  const fulfilmentPresentation = order.fulfilment
    ? presentOrderFulfilment(order.fulfilment)
    : null;

  return (
    <section className="empty-state" aria-labelledby={headingId}>
      <p className="eyebrow">Order tracking</p>
      <h1 id={headingId}>Order {order.orderNumber}</h1>
      <p>
        <strong>{order.listingTitle}</strong>
        {showVendorName ? " · " + order.vendorName : ""}
      </p>
      <p aria-label="Order status" role="status">
        <strong>{presentation.title}</strong>
      </p>
      {fulfilmentPresentation ? (
        <>
          <p aria-label="Fulfilment status" role="status">
            <strong>{fulfilmentPresentation.title}</strong>
          </p>
          <p>{fulfilmentPresentation.description}</p>
        </>
      ) : (
        <p>{presentation.description}</p>
      )}
      <dl>
        <dt>Quantity</dt>
        <dd>{order.quantity}</dd>
        <dt>Unit price at placement</dt>
        <dd>{formatOrderMoney(order.unitPriceMinor, order.currencyCode)}</dd>
        <dt>Order total</dt>
        <dd>{formatOrderMoney(order.totalMinor, order.currencyCode)}</dd>
        <dt>Placed</dt>
        <dd>
          <time dateTime={order.placedAt}>
            {formatPlacedAt(order.placedAt)}
          </time>
        </dd>
        {order.vendorDecidedAt ? (
          <>
            <dt>Vendor decision recorded</dt>
            <dd>
              <time dateTime={order.vendorDecidedAt}>
                {formatPlacedAt(order.vendorDecidedAt)}
              </time>
            </dd>
          </>
        ) : null}
        {order.fulfilment ? (
          <>
            <dt>Processing started</dt>
            <dd>
              <time dateTime={order.fulfilment.startedAt}>
                {formatPlacedAt(order.fulfilment.startedAt)}
              </time>
            </dd>
          </>
        ) : null}
      </dl>
      <p>
        No payment has been collected through LocalHub. Fulfilment processing
        does not record pickup, delivery, handoff, or completion.
      </p>
    </section>
  );
}
