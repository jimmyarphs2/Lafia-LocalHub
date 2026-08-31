// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VendorMediaUploader } from "@/components/vendor/media/vendor-media-uploader";

const { getBrowserClient } = vi.hoisted(() => ({
  getBrowserClient: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabaseClient: getBrowserClient,
}));

const listings = [
  {
    id: "5e5e77cd-45dc-4f36-9a1f-314cad75f5db",
    status: "draft",
    title: "Amina's celebration cakes",
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function choosePdf(): void {
  const file = new File(["localhub"], "menu.pdf", {
    type: "application/pdf",
  });
  fireEvent.change(screen.getByLabelText("Choose file"), {
    target: { files: [file] },
  });
}

describe("vendor media network recovery", () => {
  it("returns negotiation transport failures to a retryable state", async () => {
    getBrowserClient.mockReturnValue({ storage: { from: vi.fn() } });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    render(<VendorMediaUploader listings={listings} providerState="ready" />);
    choosePdf();
    fireEvent.click(screen.getByRole("button", { name: "Upload original" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The secure media request could not be completed.",
    );
    expect(screen.getByText("menu.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry safely" })).toBeEnabled();
  });

  it("returns removal transport failures to a retryable state", async () => {
    const uploadToSignedUrl = vi.fn().mockResolvedValue({ error: null });
    getBrowserClient.mockReturnValue({
      storage: { from: () => ({ uploadToSignedUrl }) },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            bucket: "listing-media",
            storagePath: `${listings[0].id}/0123456789abcdef0123456789abcdef.pdf`,
            uploadToken: "signed-upload-token",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            storagePath: `${listings[0].id}/0123456789abcdef0123456789abcdef.pdf`,
            confirmed: true,
            enhanced: false,
            published: false,
            originalRetained: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);

    render(<VendorMediaUploader listings={listings} providerState="ready" />);
    choosePdf();
    fireEvent.click(screen.getByRole("button", { name: "Upload original" }));

    await screen.findByText(/Original confirmed/);
    fireEvent.click(screen.getByRole("button", { name: "Remove upload" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The secure media request could not be completed.",
      ),
    );
    expect(screen.getByText("menu.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove upload" })).toBeEnabled();
  });

  it("re-negotiates instead of reusing an expired upload token", async () => {
    const now = Date.parse("2026-08-29T12:00:00.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const storagePath = `${listings[0].id}/0123456789abcdef0123456789abcdef.pdf`;
    const uploadToSignedUrl = vi
      .fn()
      .mockResolvedValueOnce({ error: new Error("upload interrupted") })
      .mockResolvedValueOnce({ error: null });
    getBrowserClient.mockReturnValue({
      storage: { from: () => ({ uploadToSignedUrl }) },
    });

    const missingObject = jsonResponse(
      {
        ok: false,
        code: "MEDIA_OBJECT_NOT_FOUND",
        message: "The reserved original has not reached storage.",
        retryable: true,
      },
      409,
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          bucket: "listing-media",
          storagePath,
          uploadToken: "signed-upload-token-1",
          expiresAt: new Date(now + 60_000).toISOString(),
        }),
      )
      .mockResolvedValueOnce(missingObject)
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            code: "MEDIA_OBJECT_NOT_FOUND",
            message: "The reserved original has not reached storage.",
            retryable: true,
          },
          409,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          bucket: "listing-media",
          storagePath,
          uploadToken: "signed-upload-token-2",
          expiresAt: new Date(now + 180_000).toISOString(),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          storagePath,
          confirmed: true,
          enhanced: false,
          published: false,
          originalRetained: true,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<VendorMediaUploader listings={listings} providerState="ready" />);
    choosePdf();
    fireEvent.click(screen.getByRole("button", { name: "Upload original" }));

    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Retry safely" })).toBeEnabled();

    nowSpy.mockReturnValue(now + 61_000);
    fireEvent.click(screen.getByRole("button", { name: "Retry safely" }));

    await screen.findByText(/Original confirmed/);
    expect(uploadToSignedUrl.mock.calls.map((call) => call[1])).toEqual([
      "signed-upload-token-1",
      "signed-upload-token-2",
    ]);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/api/vendor/media/negotiate"),
      ),
    ).toHaveLength(2);
  });
});
