/** @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

import { LocalHubEntry } from "@/components/localhub-entry";
import {
  ENTRY_STORAGE_KEY,
  parseEntryPreferences,
  readEntryPreferences,
  saveEntryPreferences,
} from "@/lib/market/entry-preferences";

const markets = [
  {
    slug: "lafia",
    name: "Lafia",
    region: "Nasarawa State",
    country: "Nigeria",
    coordinates: { latitude: 8.4939, longitude: 8.5153 },
  },
  {
    slug: "abuja",
    name: "Abuja",
    region: "Federal Capital Territory",
    country: "Nigeria",
    coordinates: { latitude: 9.0765, longitude: 7.3986 },
  },
];
const examples = [
  "Birthday cake under ₦20,000 near me",
  "Who can fix my phone today?",
  "Office chair within ₦45,000, delivered this week",
];
const geolocation = { getCurrentPosition: vi.fn() };
const originalGeolocation = Object.getOwnPropertyDescriptor(
  navigator,
  "geolocation",
);
const originalShowModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const originalClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);

function restoreProperty(
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) Object.defineProperty(target, property, descriptor);
  else Reflect.deleteProperty(target, property);
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  mocks.push.mockReset();
  geolocation.getCurrentPosition.mockReset();
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: geolocation,
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restoreProperty(navigator, "geolocation", originalGeolocation);
  restoreProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  restoreProperty(HTMLDialogElement.prototype, "close", originalClose);
  sessionStorage.clear();
  localStorage.clear();
});

function renderEntry(
  overrides: Partial<ComponentProps<typeof LocalHubEntry>> = {},
) {
  return render(
    <LocalHubEntry
      demoMode={false}
      directoryState="ready"
      identity={null}
      markets={markets}
      {...overrides}
    />,
  );
}

function focusSearch() {
  const input = screen.getByRole("textbox", {
    name: "What do you want to find nearby?",
  });
  act(() => input.focus());
  return input;
}

function searchFor(query: string) {
  const input = focusSearch();
  fireEvent.change(input, { target: { value: query } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
}

function openArea() {
  fireEvent.click(screen.getByRole("button", { name: /^Change area,/ }));
  return screen.getByRole("dialog", { name: "Where are you discovering?" });
}

describe("LocalHubEntry", () => {
  it("keeps the idle landing clean and shows exactly three ideas on focus", () => {
    renderEntry();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Find what you neednear you.",
    );
    expect(
      screen.queryByRole("list", { name: "Search suggestions" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Tell us what you need/)).toBeVisible();

    focusSearch();

    const suggestions = within(
      screen.getByRole("list", { name: "Search suggestions" }),
    );
    expect(suggestions.getAllByRole("button")).toHaveLength(3);
    for (const example of examples) {
      expect(suggestions.getByRole("button", { name: example })).toBeVisible();
    }
  });

  it("fills a suggestion without submitting, then clears and dismisses it", () => {
    renderEntry();
    const input = focusSearch();

    fireEvent.click(screen.getByRole("button", { name: examples[0] }));

    expect(input).toHaveValue(examples[0]);
    expect(input).toHaveFocus();
    expect(mocks.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input).toHaveValue("");
    expect(
      screen.getByRole("list", { name: "Search suggestions" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Close suggestions" }));
    expect(
      screen.queryByRole("list", { name: "Search suggestions" }),
    ).not.toBeInTheDocument();
  });

  it("dismisses suggestions with Escape or a pointer outside the composer", () => {
    renderEntry();
    const input = focusSearch();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).not.toHaveFocus();
    expect(
      screen.queryByRole("list", { name: "Search suggestions" }),
    ).not.toBeInTheDocument();

    focusSearch();
    fireEvent.pointerDown(screen.getByRole("heading", { level: 1 }));
    expect(
      screen.queryByRole("list", { name: "Search suggestions" }),
    ).not.toBeInTheDocument();
  });

  it("submits Enter to the existing search route with budget wording preserved", () => {
    renderEntry();
    searchFor(examples[2]);

    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
      `/lafia/search?q=${encodeURIComponent(examples[2])}`,
    );
    expect(parseEntryPreferences(readEntryPreferences()).recent).toEqual([
      { market: "lafia", query: examples[2] },
    ]);
    expect(localStorage.getItem(ENTRY_STORAGE_KEY)).toBeNull();
  });

  it("does not submit whitespace, Shift+Enter, or an IME composition", () => {
    renderEntry();
    searchFor("   \n  ");
    const input = focusSearch();
    fireEvent.change(input, { target: { value: examples[0] } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(mocks.push).not.toHaveBeenCalled();
    expect(readEntryPreferences()).toBe("");
  });

  it("searches a manually selected published non-Lafia market", () => {
    renderEntry();
    const dialog = openArea();
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Abuja Federal Capital/ }),
    );

    expect(dialog).not.toHaveAttribute("open");
    expect(
      screen.getByRole("button", { name: "Change area, Abuja" }),
    ).toBeVisible();
    searchFor(examples[0]);
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
      `/abuja/search?q=${encodeURIComponent(examples[0])}`,
    );
  });

  it("retains an unsupported city honestly and does not send its search to Lafia", () => {
    renderEntry();
    const dialog = openArea();
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "City or area" }),
      {
        target: { value: "Jos" },
      },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Use “Jos”" }));
    searchFor("Phone repair under ₦10,000");

    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "We can’t offer a published directory for Jos yet.",
    );
    expect(parseEntryPreferences(readEntryPreferences())).toEqual({
      area: { slug: "", name: "Jos" },
      recent: [],
    });
  });

  it("does not claim an empty catalogue when published areas are unavailable", () => {
    renderEntry({ markets: [], directoryState: "unavailable" });
    searchFor(examples[0]);

    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "We can’t confirm area availability right now.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your search has not been posted or sent to a business.",
    );
  });

  it("uses this tab’s selected-area history and lets the user clear it", () => {
    saveEntryPreferences({
      area: { slug: "lafia", name: "Lafia" },
      recent: [
        { market: "abuja", query: "Abuja office furniture" },
        { market: "lafia", query: "Tailor under ₦15,000" },
      ],
    });
    renderEntry();
    focusSearch();
    const suggestions = within(
      screen.getByRole("list", { name: "Search suggestions" }),
    );

    expect(suggestions.getAllByRole("button")).toHaveLength(3);
    expect(suggestions.getAllByRole("button")[0]).toHaveAccessibleName(
      "Tailor under ₦15,000",
    );
    expect(
      suggestions.queryByRole("button", { name: "Abuja office furniture" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Based on searches in this tab/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));

    expect(parseEntryPreferences(readEntryPreferences())).toEqual({
      area: { slug: "lafia", name: "Lafia" },
      recent: [],
    });
    expect(screen.getByText("Try asking LocalHub")).toBeVisible();
    expect(localStorage.getItem(ENTRY_STORAGE_KEY)).toBeNull();
  });

  it("keeps manual area selection available after location permission is denied", () => {
    geolocation.getCurrentPosition.mockImplementation((_success, failure) => {
      failure({ code: 1, message: "Permission denied" });
    });
    renderEntry();
    const dialog = openArea();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Use my location" }),
    );

    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Location wasn’t available. You can still choose your area manually.",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Abuja Federal Capital/ }),
    );
    expect(
      screen.getByRole("button", { name: "Change area, Abuja" }),
    ).toBeVisible();
  });

  it("suggests a nearby area without storing coordinates or selecting it automatically", () => {
    geolocation.getCurrentPosition.mockImplementation((success) => {
      success({
        coords: { latitude: 9.0765, longitude: 7.3986, accuracy: 20 },
      });
    });
    renderEntry();
    const dialog = openArea();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Use my location" }),
    );

    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "You appear to be near Abuja. Select it below to confirm.",
    );
    expect(readEntryPreferences()).toBe("");
    expect(
      screen.getByRole("button", { name: "Change area, Lafia" }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Abuja Federal Capital/ }),
    );

    expect(JSON.parse(readEntryPreferences())).toEqual({
      area: { slug: "abuja", name: "Abuja" },
      recent: [],
    });
    expect(readEntryPreferences()).not.toMatch(
      /latitude|longitude|accuracy|coordinates/,
    );
    expect(localStorage.length).toBe(0);
  });

  it("does not request device location in fictional demo mode", () => {
    renderEntry({ demoMode: true });
    const dialog = openArea();
    const locationButton = within(dialog).getByRole("button", {
      name: "Use my location",
    });
    expect(locationButton).toBeDisabled();
    fireEvent.click(locationButton);
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("opens a truthful request explanation without posting or contacting a business", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    renderEntry();
    fireEvent.click(screen.getByRole("button", { name: "Post a request" }));
    const dialog = screen.getByRole("dialog", {
      name: "Let’s find the right business",
    });

    expect(
      within(dialog).getByText(/Public request posting isn’t available yet/),
    ).toBeVisible();
    expect(dialog.querySelector("form")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(readEntryPreferences()).toBe("");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Find a business" }),
    );
    expect(dialog).not.toHaveAttribute("open");
    expect(
      screen.getByRole("textbox", { name: "What do you want to find nearby?" }),
    ).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
  });
});
