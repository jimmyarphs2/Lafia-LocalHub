// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mark: vi.fn() }));

vi.mock("@/app/[market]/activity/actions", () => ({
  markNotificationRead: mocks.mark,
}));

import { NotificationReadControl } from "@/app/[market]/activity/notification-controls";

const notificationId = "11111111-1111-4111-8111-111111111111";
const readAt = "2026-08-31T10:05:00.000001Z";

function control(readAtValue: string | null = null) {
  return (
    <NotificationReadControl
      market="lafia"
      notificationId={notificationId}
      readAt={readAtValue}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NotificationReadControl", () => {
  it("renders an explicit unread status and singleton scoped hidden values", () => {
    mocks.mark.mockResolvedValue({
      ok: false,
      retryable: true,
      code: "unavailable",
      message: "Try again.",
    });
    const view = render(control());

    expect(screen.getByText(/^Unread$/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /mark as read/i })).toBeEnabled();
    expect(view.container.querySelector('input[name="market"]')).toHaveValue(
      "lafia",
    );
    expect(
      view.container.querySelector('input[name="notification_id"]'),
    ).toHaveValue(notificationId);
    expect(
      view.container.querySelectorAll('input[name="market"]'),
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll('input[name="notification_id"]'),
    ).toHaveLength(1);
  });

  it("renders an initially read state as ordinary text without a live announcement", () => {
    render(control(readAt));

    const readLabel = screen.getByText(/^Read$/i);
    expect(readLabel).toBeVisible();
    expect(readLabel).not.toHaveAttribute("role");
    expect(readLabel).not.toHaveAttribute("tabindex");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("disables the action and announces deterministic pending text", async () => {
    let resolveAction: ((value: unknown) => void) | undefined;
    mocks.mark.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );
    render(control());

    fireEvent.click(screen.getByRole("button", { name: /mark as read/i }));
    await waitFor(() => {
      expect(screen.getByRole("button")).toBeDisabled();
      expect(screen.getByRole("button")).toHaveTextContent(/marking as read/i);
      expect(screen.getByRole("status")).toHaveTextContent(/marking as read/i);
    });

    resolveAction?.({
      ok: true,
      retryable: false,
      code: "marked_read",
      message: "Marked as read.",
    });
  });

  it("focuses terminal success feedback and removes the mutation control", async () => {
    mocks.mark.mockResolvedValue({
      ok: true,
      retryable: false,
      code: "marked_read",
      message: "Marked as read.",
    });
    const view = render(control());

    fireEvent.click(screen.getByRole("button", { name: /mark as read/i }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/marked as read/i);
      expect(screen.getByRole("status")).toHaveAttribute("tabindex", "-1");
      expect(screen.getByRole("status")).toHaveFocus();
    });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    view.rerender(control(readAt));
    const refreshedCompletion = screen.getByText(/^Read$/i);
    await waitFor(() => expect(refreshedCompletion).toHaveFocus());
    expect(refreshedCompletion).toHaveAttribute("role", "status");
    expect(refreshedCompletion).toHaveAttribute("tabindex", "-1");
  });

  it("focuses a retryable alert while preserving a retry control", async () => {
    mocks.mark.mockResolvedValue({
      ok: false,
      retryable: true,
      code: "unavailable",
      message: "Notification service is temporarily unavailable.",
    });
    render(control());

    fireEvent.click(screen.getByRole("button", { name: /mark as read/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/temporarily unavailable/i);
    expect(alert).toHaveAttribute("tabindex", "-1");
    expect(alert).toHaveFocus();
    expect(screen.getByRole("button", { name: /mark as read/i })).toBeEnabled();
  });

  it("stops a definitive not-found result from repeating the mutation", async () => {
    mocks.mark.mockResolvedValue({
      ok: false,
      retryable: false,
      code: "not_found",
      message: "This notification is no longer available.",
    });
    render(control());

    fireEvent.click(screen.getByRole("button", { name: /mark as read/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no longer available/i);
    expect(alert).toHaveFocus();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses React action state rather than an ad-hoc client mutation", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/[market]/activity/notification-controls.tsx"),
      "utf8",
    );
    expect(source).toContain("useActionState");
    expect(source).toContain("disabled={pending}");
    expect(source).not.toMatch(
      /fetch\(|supabase\/admin|service_role|\.from\(["']notifications["']\)/,
    );
  });
});
