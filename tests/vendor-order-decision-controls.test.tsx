// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ respond: vi.fn() }));

vi.mock("@/app/vendor/orders/actions", () => ({
  respondToVendorOrder: mocks.respond,
}));

import { OrderDecisionControls } from "@/components/vendor/order-decision-controls";

const orderId = "66666666-6666-4666-8666-666666666666";
const idempotencyKey = "77777777-7777-4777-8777-777777777777";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrderDecisionControls", () => {
  it("offers accessible payment- and fulfilment-free decisions only while placed", () => {
    render(
      <OrderDecisionControls
        initialIdempotencyKey={idempotencyKey}
        orderId={orderId}
      />,
    );

    expect(
      screen.getByRole("group", { name: "Decide vendor availability" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm order" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeEnabled();
    expect(
      screen.getByText(/does not collect payment or start fulfilment/i),
    ).toBeVisible();
    expect(screen.getByText(/no refund is created/i)).toBeVisible();
  });

  it("requires an explicit, focused confirmation before cancelling", () => {
    render(
      <OrderDecisionControls
        initialIdempotencyKey={idempotencyKey}
        orderId={orderId}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));

    expect(mocks.respond).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Cancel this order?" }),
    ).toHaveFocus();
    expect(screen.getByText(/cannot be undone/i)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Yes, cancel order" }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Keep order" }));
    expect(screen.getByRole("button", { name: "Cancel order" })).toHaveFocus();
  });

  it("disables both decisions while pending and preserves retries", async () => {
    let resolveAction: ((value: unknown) => void) | undefined;
    mocks.respond.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );
    render(
      <OrderDecisionControls
        initialIdempotencyKey={idempotencyKey}
        orderId={orderId}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm order" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Confirm order" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Cancel order" }),
      ).toBeDisabled();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Saving vendor decision",
      );
    });
    resolveAction?.({
      ok: false,
      retryable: true,
      code: "unavailable",
      message: "Try again.",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again.");
    expect(screen.getByRole("button", { name: "Confirm order" })).toBeEnabled();
  });

  it("focuses persistent terminal feedback and removes controls after success", async () => {
    mocks.respond.mockResolvedValue({
      ok: true,
      retryable: false,
      code: "transitioned",
      status: "confirmed",
      message:
        "Vendor availability has been recorded. No payment has been collected and fulfilment has not started.",
    });
    const view = render(
      <OrderDecisionControls
        initialIdempotencyKey={idempotencyKey}
        orderId={orderId}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm order" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "availability has been recorded",
      );
      expect(screen.getByRole("status")).toHaveFocus();
    });
    expect(
      screen.queryByRole("button", { name: "Cancel order" }),
    ).not.toBeInTheDocument();

    view.rerender(
      <OrderDecisionControls
        initialIdempotencyKey={idempotencyKey}
        orderId={orderId}
        status="confirmed"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "availability has been recorded",
    );
  });

  it("focuses the terminal status when an RSC refresh changes the prop", async () => {
    const view = render(
      <OrderDecisionControls
        initialIdempotencyKey={idempotencyKey}
        orderId={orderId}
      />,
    );

    view.rerender(
      <OrderDecisionControls
        initialIdempotencyKey={idempotencyKey}
        orderId={orderId}
        status="cancelled"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Vendor cancelled");
      expect(screen.getByRole("status")).toHaveFocus();
    });
    expect(
      screen.queryByRole("button", { name: "Confirm order" }),
    ).not.toBeInTheDocument();
  });

  it("never exposes decisions for terminal orders", () => {
    render(
      <OrderDecisionControls
        initialIdempotencyKey={idempotencyKey}
        orderId={orderId}
        status="cancelled"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Vendor cancelled");
    expect(
      screen.queryByRole("button", { name: "Confirm order" }),
    ).not.toBeInTheDocument();
  });
});
