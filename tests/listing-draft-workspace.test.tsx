// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrandMark } from "@/components/brand-mark";
import { ListingDraftWorkspace } from "@/components/vendor/listing-draft-workspace";
import type { VendorListingDraftWorkspace } from "@/lib/listings/workspace";

const { saveAction } = vi.hoisted(() => ({ saveAction: vi.fn() }));

vi.mock("@/app/vendor/listings/actions", () => ({
  saveVendorListingDraft: saveAction,
}));

const businessId = "2dd03116-25d7-4f7f-9703-e9cda24d265b";
const listingId = "5e5e77cd-45dc-4f36-9a1f-314cad75f5db";
const schemaId = "d452d2fc-2d03-4d88-9e35-9f6a0b5fa5de";
const createIdempotencyKey = "26aa9e8f-1f6c-4eb2-bb97-e151f1c63e45";

function workspace(
  selectedDraft: VendorListingDraftWorkspace["selectedDraft"] = null,
): VendorListingDraftWorkspace {
  return {
    businessId,
    categoryId: "d6b31b12-85c9-4325-9abc-0f2d6e4f1cc4",
    categorySlug: "cakes",
    mapping: {
      listingTypeId: "bb680959-4fc7-47a3-a53f-90e79a489c2d",
      listingTypeCode: "product",
      schemaId,
      schemaKey: "cake_product",
      schemaVersion: 1,
    },
    schema: {
      contractVersion: "1.1",
      schemaVersion: 1,
      schemaKey: "cake_product",
      listingKind: "product",
      terminology: {
        singular: "product",
        plural: "products",
        createAction: "Create product draft",
      },
      bindings: { title: "title" },
      fields: [
        {
          key: "title",
          label: "Listing title",
          type: "short_text",
          minLength: 2,
          maxLength: 120,
          required: true,
        },
      ],
    },
    selectedDraft,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/vendor/listings");
});

describe("listing draft workspace", () => {
  it("restores server-provided values without nesting a form", () => {
    render(
      <ListingDraftWorkspace
        createIdempotencyKey={createIdempotencyKey}
        workspace={workspace({
          listingId,
          revision: 3,
          slug: "celebration-cake",
          updatedAt: "2026-08-29T12:00:00.000Z",
          values: { title: "Celebration cake" },
        })}
      />,
    );

    expect(screen.getByLabelText(/Listing title/)).toHaveValue(
      "Celebration cake",
    );
    expect(screen.getByText("Revision 3")).toBeInTheDocument();
    expect(document.querySelectorAll("form")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Add original media" }),
    ).toHaveAttribute("href", `/vendor/media-lab?listing=${listingId}`);
  });

  it("preserves newer typing when an older save finishes", async () => {
    let resolveSave: (value: unknown) => void = () => undefined;
    saveAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(
      <ListingDraftWorkspace
        createIdempotencyKey={createIdempotencyKey}
        workspace={workspace({
          listingId,
          revision: 3,
          slug: "celebration-cake",
          updatedAt: "2026-08-29T12:00:00.000Z",
          values: { title: "Celebration cake" },
        })}
      />,
    );

    const title = screen.getByLabelText(/Listing title/);
    fireEvent.change(title, { target: { value: "Saved version" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Saving your draft…")).toBeInTheDocument();

    fireEvent.change(title, { target: { value: "Newer unsaved version" } });
    resolveSave({
      ok: true,
      outcome: "updated",
      listingId,
      revision: 4,
      savedAt: "2026-08-29T12:02:00.000Z",
    });

    await waitFor(() => expect(title).toHaveValue("Newer unsaved version"));
    expect(
      screen.getByText("Unsaved changes · save before leaving"),
    ).toBeInTheDocument();
  });

  it("lets the workspace veto navigation away from unsaved changes", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <ListingDraftWorkspace
        createIdempotencyKey={createIdempotencyKey}
        workspace={workspace({
          listingId,
          revision: 3,
          slug: "celebration-cake",
          updatedAt: "2026-08-29T12:00:00.000Z",
          values: { title: "Celebration cake" },
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Listing title/), {
      target: { value: "Unsaved title" },
    });
    const link = screen.getByRole("link", { name: "Add original media" });

    expect(fireEvent.click(link)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      "This draft has unsaved changes. Leave without saving them?",
    );
  });

  it("guards the vendor brand mark and browser history from unsaved changes", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const forward = vi
      .spyOn(window.history, "forward")
      .mockImplementation(() => undefined);
    render(
      <>
        <BrandMark guardDraftNavigation />
        <ListingDraftWorkspace
          createIdempotencyKey={createIdempotencyKey}
          workspace={workspace({
            listingId,
            revision: 3,
            slug: "celebration-cake",
            updatedAt: "2026-08-29T12:00:00.000Z",
            values: { title: "Celebration cake" },
          })}
        />
      </>,
    );

    fireEvent.change(screen.getByLabelText(/Listing title/), {
      target: { value: "Unsaved title" },
    });

    expect(
      fireEvent.click(screen.getByRole("link", { name: /LocalHub/ })),
    ).toBe(false);
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("reuses one browser-history guard across repeated save cycles", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    saveAction
      .mockResolvedValueOnce({
        ok: true,
        outcome: "updated",
        listingId,
        revision: 4,
        savedAt: "2026-08-29T12:03:00.000Z",
      })
      .mockResolvedValueOnce({
        ok: true,
        outcome: "updated",
        listingId,
        revision: 5,
        savedAt: "2026-08-29T12:04:00.000Z",
      });
    render(
      <ListingDraftWorkspace
        createIdempotencyKey={createIdempotencyKey}
        workspace={workspace({
          listingId,
          revision: 3,
          slug: "celebration-cake",
          updatedAt: "2026-08-29T12:00:00.000Z",
          values: { title: "Celebration cake" },
        })}
      />,
    );

    const title = screen.getByLabelText(/Listing title/);
    fireEvent.change(title, { target: { value: "First saved title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(screen.getByText(/Saved at/)).toHaveTextContent("Revision 4"),
    );

    fireEvent.change(title, { target: { value: "Second saved title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(screen.getByText(/Saved at/)).toHaveTextContent("Revision 5"),
    );

    expect(saveAction).toHaveBeenCalledTimes(2);
    expect(pushState).toHaveBeenCalledTimes(1);
  });

  it("retries autosave after the vendor changes a value that failed", async () => {
    saveAction
      .mockResolvedValueOnce({
        ok: false,
        code: "persistence",
        message: "Temporary save failure.",
      })
      .mockResolvedValueOnce({
        ok: true,
        outcome: "updated",
        listingId,
        revision: 4,
        savedAt: "2026-08-29T12:03:00.000Z",
      });
    render(
      <ListingDraftWorkspace
        createIdempotencyKey={createIdempotencyKey}
        workspace={workspace({
          listingId,
          revision: 3,
          slug: "celebration-cake",
          updatedAt: "2026-08-29T12:00:00.000Z",
          values: { title: "Celebration cake" },
        })}
      />,
    );

    const title = screen.getByLabelText(/Listing title/);
    fireEvent.change(title, { target: { value: "First attempt" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Temporary save failure.",
    );

    fireEvent.change(title, { target: { value: "Retry this version" } });
    await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(2), {
      timeout: 4_000,
    });
    expect(saveAction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedRevision: 3,
        listingId,
        values: { title: "Retry this version" },
      }),
    );
  }, 10_000);

  it("shows a pending status, saves a new draft, and makes its URL canonical", async () => {
    let resolveSave: (value: unknown) => void = () => undefined;
    saveAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(
      <ListingDraftWorkspace
        createIdempotencyKey={createIdempotencyKey}
        workspace={workspace()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Listing title/), {
      target: { value: "Celebration cake" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByText("Saving your draft…")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Saving draft…" }),
    ).toBeDisabled();
    expect(saveAction).toHaveBeenCalledWith(
      expect.objectContaining({
        createIdempotencyKey,
        expectedSchemaId: schemaId,
        listingId: undefined,
        targetBusinessId: businessId,
        values: { title: "Celebration cake" },
      }),
    );

    resolveSave({
      ok: true,
      outcome: "created",
      listingId,
      revision: 1,
      savedAt: "2026-08-29T12:01:00.000Z",
    });

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Add original media" }),
      ).toBeInTheDocument(),
    );
    expect(window.location.search).toBe(
      `?business=${businessId}&draft=${listingId}`,
    );
    expect(screen.getByText(/Revision 1/)).toBeInTheDocument();
  });

  it("announces and focuses a revision conflict", async () => {
    saveAction.mockResolvedValue({
      ok: false,
      code: "conflict",
      message: "This draft changed elsewhere. Refresh it before saving again.",
    });
    render(
      <ListingDraftWorkspace
        createIdempotencyKey={createIdempotencyKey}
        workspace={workspace({
          listingId,
          revision: 1,
          slug: "celebration-cake",
          updatedAt: "2026-08-29T12:00:00.000Z",
          values: { title: "Celebration cake" },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This draft changed elsewhere");
    await waitFor(() => expect(alert).toHaveFocus());
  });
});
