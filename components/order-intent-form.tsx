import { ArrowRight } from "lucide-react";

import {
  ORDER_QUANTITY_MAXIMUM,
  ORDER_QUANTITY_MINIMUM,
} from "@/lib/orders/contract";

import styles from "./order-forms.module.css";

export function OrderIntentForm({
  market,
  listing,
}: {
  market: string;
  listing: string;
}) {
  return (
    <form
      action={`/${market}/listings/${listing}/order/intent`}
      className={styles.form}
      method="post"
    >
      <div className={styles.field}>
        <label htmlFor="order-quantity">Quantity</label>
        <input
          aria-describedby="order-quantity-help"
          defaultValue={ORDER_QUANTITY_MINIMUM}
          id="order-quantity"
          inputMode="numeric"
          max={ORDER_QUANTITY_MAXIMUM}
          min={ORDER_QUANTITY_MINIMUM}
          name="quantity"
          required
          step={1}
          type="number"
        />
        <p className={styles.help} id="order-quantity-help">
          Choose 1–100. You will review the server-confirmed price before
          placing the order. No payment is collected here.
        </p>
      </div>
      <button className="button button-primary" type="submit">
        Review order <ArrowRight aria-hidden="true" size={17} />
      </button>
    </form>
  );
}
