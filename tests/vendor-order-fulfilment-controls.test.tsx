// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("@/app/vendor/orders/fulfilment-actions", () => ({
  startVendorOrderFulfilment: mocks.start,
}));

import { OrderFulfilmentControls } from "@/components/vendor/order-fulfilment-controls";

const orderId = "66666666-6666-4666-8666-666666666666";
const idempotencyKey = "77777777-7777-4777-8777-777777777777";
const processing = {
  id: "88888888-8888-4888-8888-888888888888",
  status: "processing" as const,
  startedAt: "2026-08-30T10:00:00.000Z",
  updatedAt: "2026-08-30T10:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrderFulfilmentControls", () => {
  it("offers the controlled action only for an unprocessed confirmed order", () => {
    const { rerender } = render(
      <OrderFulfilmentControls
        fulfilment={null}
        initialIdempotencyKey={idempotencyKey}
        orderId={orderId}
        status="confirmed"
      />,
    );

    expect(
      screen.getByRole("group", { name: "Start fulfilment processing" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Start processing" }),
    ).toBeEnabled();
    expect(screen.getByText(/does not collect payment/i)).toBeVisible();
    expect(
      screen.getByText(/does not.*arrange pickup or delivery/i),
    ).toBeVisible();

    rerender(
      <OrderFulfilmentControls
        fulfilment={null}
        initialIdempotencyKey={idempotencyKey}
        orderId={orderId}
        status="placed"
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Start processing" }),
    ).not.toBeInTheDocument();
  });

  it("requires explicit focused confirmation before starting processing", () => {
    render(
      <OrderFulfilmentControls
        fulfilment={null}
        initialIdempotencyKey={idempotencyKey}
        orderId={orderId}
        status="confirmed"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start processing" }));
    expect(mocks.start).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Start processing this order?" }),
    ).toHaveFocus();
    const confirmation = screen.getByRole("region", {
      name: "Start processing this order?",
    });
    expect(confirmation).toHaveAttribute(
      "aria-describedby",
      "start-processing-description",
    );
    expect(
      document.getElementById("start-processing-description"),
    ).toHaveTextContent(/does not collect payment/i);
    expect(
      screen.getByRole("button", { name: "Yes, start processing" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
    expect(
      screen.getByRole("button", { name: "Start processing" }),
    ).toHaveFocus();
  });

  it("disables confirmation controls while pending and preserves a retryable action", async () => {
    let resolveAction: ((value: unknown) => void) | undefined;
    mocks.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );
    mocks.start.mockResolvedValueOnce({
      ok: false,
      retryable: true,
      code: "unavailable",
      message: "Try again.",
    });
    render(
      <OrderFulfilmentControls
        fulfilment={null}
        initialIdempotencyKey={idempotencyKey}
        orderId={orderId}
        status="confirmed"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start processing" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, start processing" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Not yet" })).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Yes, start processing" }),
      ).toBeDisabled();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Saving fulfilment processing",
      );
    });
    resolveAction?.({
      ok: false,
      retryable: true,
      code: "unavailable",
      message: "Try again.",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again.");
    expect(
      screen.getByRole("button", { name: "Yes, start processing" }),
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, start processing" }),
    );
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));
    const firstSubmission = mocks.start.mock.calls[0]?.[1] as FormData;
    const retrySubmission = mocks.start.mock.calls[1]?.[1] as FormData;
    expect(firstSubmission.get("idempotency_key")).toBe(idempotencyKey);
    expect(retrySubmission.get("idempotency_key")).toBe(idempotencyKey);
  });

  it("focuses terminal error feedback", async () => {
    mocks.start.mockResolvedValue({
      ok: false,
      retryable: false,
      code: "unauthorized",
      message: "Sign in again before starting processing.",
    });
    render(
      <OrderFulfilmentControls
        fulfilment={null}
        initialIdempotencyKey={idempotencyKey}
        orderId={orderId}
        status="confirmed"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start processing" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, start processing" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Sign in again before starting processing.",
      );
      expect(screen.getByRole("alert")).toHaveFocus();
    });
  });

  it("focuses processing feedback after action success or canonical refresh", async () => {
    mocks.start.mockResolvedValue({
      ok: true,
      retryable: false,
      code: "started",
      status: "processing",
      message:
        "Vendor is processing your order. The vendor has recorded that they have begun handling it. LocalHub has not collected payment. Pickup, delivery, handoff, and completion are not yet recorded.",
    });
    const view = render(
      <OrderFulfilmentControls
        fulfilment={null}
        initialIdempotencyKey={idempotencyKey}
        orderId={orderId}
        status="confirmed"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start processing" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, start processing" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveFocus();
    });

    view.rerender(
      <OrderFulfilmentControls
        fulfilment={processing}
        initialIdempotencyKey={idempotencyKey}
        orderId={orderId}
        status="confirmed"
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Vendor is processing your order",
      );
      expect(screen.getByRole("status")).toHaveFocus();
    });
    expect(
      screen.queryByRole("button", { name: "Start processing" }),
    ).not.toBeInTheDocument();
  });
});
