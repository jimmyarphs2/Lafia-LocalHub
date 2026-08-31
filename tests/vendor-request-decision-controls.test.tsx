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

vi.mock("@/app/vendor/requests/actions", () => ({
  respondToVendorRequest: mocks.respond,
}));

import { RequestDecisionControls } from "@/components/vendor/request-decision-controls";

const requestId = "66666666-6666-4666-8666-666666666666";
const idempotencyKey = "77777777-7777-4777-8777-777777777777";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RequestDecisionControls", () => {
  it("offers an accessible follow-up-only decision group while the request is open", () => {
    mocks.respond.mockResolvedValue({
      ok: false,
      retryable: true,
      code: "unavailable",
      message: "Try again.",
    });
    render(
      <RequestDecisionControls
        initialIdempotencyKey={idempotencyKey}
        requestId={requestId}
      />,
    );

    expect(
      screen.getByRole("group", { name: "Respond to customer request" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Accept request" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Decline request" }),
    ).toBeEnabled();
    expect(screen.getByText(/no booking, order, or payment/i)).toBeVisible();
  });

  it("disables both decisions while pending and preserves retry controls after a retryable failure", async () => {
    let resolveAction: ((value: unknown) => void) | undefined;
    mocks.respond.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );
    render(
      <RequestDecisionControls
        initialIdempotencyKey={idempotencyKey}
        requestId={requestId}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept request" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Accept request" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Decline request" }),
      ).toBeDisabled();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Saving vendor response",
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
      screen.getByRole("button", { name: "Accept request" }),
    ).toBeEnabled();
  });

  it("announces successful follow-up without creating a transaction", async () => {
    mocks.respond.mockResolvedValue({
      ok: true,
      retryable: false,
      code: "transitioned",
      status: "accepted",
      message:
        "Vendor response saved. This starts follow-up only; no booking, order, or payment was created.",
    });
    const view = render(
      <RequestDecisionControls
        initialIdempotencyKey={idempotencyKey}
        requestId={requestId}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept request" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("follow-up only");
      expect(screen.getByRole("status")).toHaveFocus();
    });
    expect(
      screen.queryByRole("button", { name: "Decline request" }),
    ).not.toBeInTheDocument();

    view.rerender(
      <RequestDecisionControls
        initialIdempotencyKey={idempotencyKey}
        requestId={requestId}
        status="accepted"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("follow-up only");
    expect(screen.getByRole("status")).toHaveFocus();
  });

  it("moves focus to canonical terminal feedback when an RSC refresh changes the status", async () => {
    const view = render(
      <RequestDecisionControls
        initialIdempotencyKey={idempotencyKey}
        requestId={requestId}
      />,
    );
    screen.getByRole("button", { name: "Accept request" }).focus();

    view.rerender(
      <RequestDecisionControls
        initialIdempotencyKey={idempotencyKey}
        requestId={requestId}
        status="accepted"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Vendor accepted for follow-up",
      );
      expect(screen.getByRole("status")).toHaveFocus();
    });
    expect(
      screen.queryByRole("button", { name: "Accept request" }),
    ).not.toBeInTheDocument();
  });

  it("stops definitive outcomes from reusing the same idempotency key", async () => {
    mocks.respond.mockResolvedValue({
      ok: false,
      retryable: false,
      code: "idempotency_key_reused",
      message: "Refresh the inbox before trying again.",
    });
    render(
      <RequestDecisionControls
        initialIdempotencyKey={idempotencyKey}
        requestId={requestId}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Refresh the inbox",
    );
    expect(
      screen.queryByRole("button", { name: "Accept request" }),
    ).not.toBeInTheDocument();
  });
});
