// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCatalogForMarket: vi.fn(),
  getServerSupabaseClient: vi.fn(),
  redirect: vi.fn(),
  submit: vi.fn(),
  useFormStatus: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/catalog/source", () => ({
  getCatalogForMarket: mocks.getCatalogForMarket,
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: mocks.getServerSupabaseClient,
}));
vi.mock("@/app/[market]/demand/confirm/actions", () => ({
  submitUnmetDemandObservation: mocks.submit,
}));
vi.mock("react-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-dom")>();
  return { ...original, useFormStatus: mocks.useFormStatus };
});

import DemandConfirmationPage from "@/app/[market]/demand/confirm/page";
import { DemandSubmitButton } from "@/components/demand-submit-button";

const categoryId = "77777777-7777-4777-8777-777777777777";

beforeEach(() => {
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  });
  mocks.useFormStatus.mockReturnValue({ pending: false });
  mocks.getServerSupabaseClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user" } } }),
    },
  });
  mocks.getCatalogForMarket.mockResolvedValue({
    source: "supabase",
    state: "ready",
    complete: true,
    market: { id: "market", slug: "lagos" },
    categories: [
      {
        id: categoryId,
        marketId: "market",
        name: "Catering",
        slug: "catering",
      },
    ],
    listings: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("unmet-demand confirmation UI", () => {
  it("renders an explicit, category-only POST confirmation for an authenticated user", async () => {
    const page = await DemandConfirmationPage({
      params: Promise.resolve({ market: "lagos" }),
      searchParams: Promise.resolve({ category: categoryId }),
    });

    const view = render(page);

    expect(
      screen.getByRole("heading", { name: "Record a Catering category gap" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Record category gap" }),
    ).toBeEnabled();
    expect(screen.getByText(/does not guarantee/i)).toBeVisible();
    expect(view.container.querySelector('input[name="market"]')).toHaveValue(
      "lagos",
    );
    expect(
      view.container.querySelector('input[name="category_id"]'),
    ).toHaveValue(categoryId);
    expect(view.container.querySelector('input[name="q"]')).toBeNull();
  });

  it("exposes an unavailable outcome as an alert without claiming a write", async () => {
    const page = await DemandConfirmationPage({
      params: Promise.resolve({ market: "lagos" }),
      searchParams: Promise.resolve({
        category: categoryId,
        error: "unavailable",
      }),
    });

    render(page);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /could not record this category gap/i,
    );
    expect(
      screen.queryByText(/category gap recorded/i),
    ).not.toBeInTheDocument();
  });

  it("disables the submit control and announces its pending action", () => {
    const view = render(<DemandSubmitButton />);
    expect(
      screen.getByRole("button", { name: "Record category gap" }),
    ).toBeEnabled();

    mocks.useFormStatus.mockReturnValue({ pending: true });
    view.rerender(<DemandSubmitButton />);

    expect(
      screen.getByRole("button", { name: "Recording category gap…" }),
    ).toBeDisabled();
  });
});
