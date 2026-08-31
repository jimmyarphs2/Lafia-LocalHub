import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { OrderIntentForm } from "@/components/order-intent-form";

describe("OrderIntentForm", () => {
  it("posts only a bounded, labelled quantity before authenticated confirmation", () => {
    const markup = renderToStaticMarkup(
      <OrderIntentForm listing="safe-vendor~safe-listing" market="lafia" />,
    );
    expect(markup).toContain(
      'action="/lafia/listings/safe-vendor~safe-listing/order/intent"',
    );
    expect(markup).toContain('method="post"');
    expect(markup).toContain('for="order-quantity"');
    expect(markup).toContain('aria-describedby="order-quantity-help"');
    expect(markup).toContain('name="quantity"');
    expect(markup).toContain('min="1"');
    expect(markup).toContain('max="100"');
    expect(markup).toContain('step="1"');
    expect(markup).toContain("No payment is collected here.");
    expect(markup).not.toContain('name="price"');
    expect(markup).not.toContain('name="listing_id"');
  });
});
