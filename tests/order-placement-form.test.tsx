// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ placeOrder: vi.fn() }));

vi.mock("@/app/[market]/listings/[listing]/order/actions", () => ({
  placeListingOrder: mocks.placeOrder,
}));

import { OrderPlacementForm } from "@/components/order-placement-form";

const intentId = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrderPlacementForm", () => {
  it("submits only the intent identity with truthful no-payment copy", () => {
    mocks.placeOrder.mockResolvedValue({
      ok: false,
      code: "provider_unavailable",
      message: "Try again.",
      retryable: true,
    });
    const { container } = render(<OrderPlacementForm intentId={intentId} />);
    expect(screen.getByRole("button", { name: "Place order" })).toBeEnabled();
    expect(screen.getByText(/no payment is collected/i)).toBeVisible();
    const inputs = Array.from(container.querySelectorAll("input"));
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toHaveAttribute("name", "intent_id");
    expect(inputs[0]).toHaveValue(intentId);
  });

  it("disables placement and announces progress while pending", async () => {
    let resolveAction: ((value: unknown) => void) | undefined;
    mocks.placeOrder.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );
    render(<OrderPlacementForm intentId={intentId} />);
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Placing order…" }),
      ).toBeDisabled();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Placing your order",
      );
    });
    resolveAction?.({
      ok: false,
      code: "provider_unavailable",
      message: "Try again.",
      retryable: true,
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Try again.");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByRole("button", { name: "Place order" })).toBeEnabled();
  });

  it("focuses definitive feedback and removes the stale submit control", async () => {
    mocks.placeOrder.mockResolvedValue({
      ok: false,
      code: "quote_changed",
      message: "Review a new order.",
      retryable: false,
    });
    render(<OrderPlacementForm intentId={intentId} />);
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(alert).toHaveTextContent("Review a new order.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
