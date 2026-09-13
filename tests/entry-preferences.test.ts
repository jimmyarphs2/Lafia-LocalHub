/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanEntryText,
  ENTRY_STORAGE_KEY,
  parseEntryPreferences,
  readEntryPreferences,
  saveEntryPreferences,
  subscribeEntryPreferences,
} from "@/lib/market/entry-preferences";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

describe("entry preferences", () => {
  it("normalizes control characters, whitespace, and maximum query length", () => {
    expect(cleanEntryText(" \u0000 Cake\n under\t ₦20,000 \u007f ")).toBe(
      "Cake under ₦20,000",
    );
    expect(cleanEntryText("a".repeat(200))).toHaveLength(160);
    expect(cleanEntryText("City name", 4)).toBe("City");
  });

  it.each(["", "not json", "null", "false", "42"])(
    "fails safely for invalid saved preferences: %s",
    (raw) => {
      expect(parseEntryPreferences(raw)).toEqual({ recent: [] });
    },
  );

  it("allowlists parsed fields and drops coordinates and other unrelated data", () => {
    const parsed = parseEntryPreferences(
      JSON.stringify({
        area: {
          slug: "abuja",
          name: " Abuja ",
          coordinates: { latitude: 9.0765, longitude: 7.3986 },
        },
        recent: [
          {
            market: "abuja",
            query: " Cake\nunder ₦20,000 ",
            accountId: "private",
          },
          null,
          { market: 42, query: "invalid" },
          { market: "abuja", query: "   " },
        ],
        latitude: 9.0765,
        longitude: 7.3986,
      }),
    );

    expect(parsed).toEqual({
      area: { slug: "abuja", name: "Abuja" },
      recent: [{ market: "abuja", query: "Cake under ₦20,000" }],
    });
    expect(JSON.stringify(parsed)).not.toMatch(
      /latitude|longitude|coordinates|accountId/,
    );
  });

  it("keeps an unsupported manual city but rejects a route-unsafe area slug", () => {
    expect(
      parseEntryPreferences(
        JSON.stringify({ area: { slug: "", name: "Jos" } }),
      ),
    ).toEqual({ area: { slug: "", name: "Jos" }, recent: [] });
    expect(
      parseEntryPreferences(
        JSON.stringify({ area: { slug: "../../vendor", name: "Unsafe" } }),
      ).area,
    ).toBeUndefined();
  });

  it("bounds recent history to six entries and limits stored text lengths", () => {
    const parsed = parseEntryPreferences(
      JSON.stringify({
        area: { slug: "a".repeat(100), name: "A".repeat(100) },
        recent: Array.from({ length: 9 }, (_, index) => ({
          market: "lafia",
          query: `${index} ${"x".repeat(200)}`,
        })),
      }),
    );

    expect(parsed.area?.slug).toHaveLength(80);
    expect(parsed.area?.name).toHaveLength(60);
    expect(parsed.recent).toHaveLength(6);
    expect(parsed.recent.every((item) => item.query.length === 160)).toBe(true);
  });

  it("writes this tab’s session storage only and can clear history without losing area", () => {
    const area = { slug: "lafia", name: "Lafia" };
    const onChange = vi.fn();
    const unsubscribe = subscribeEntryPreferences(onChange);
    saveEntryPreferences({
      area,
      recent: [{ market: "lafia", query: "Cake" }],
    });

    expect(JSON.parse(sessionStorage.getItem(ENTRY_STORAGE_KEY)!)).toEqual({
      area,
      recent: [{ market: "lafia", query: "Cake" }],
    });
    expect(localStorage.getItem(ENTRY_STORAGE_KEY)).toBeNull();
    expect(onChange).toHaveBeenCalledOnce();

    saveEntryPreferences({
      ...parseEntryPreferences(readEntryPreferences()),
      recent: [],
    });
    expect(parseEntryPreferences(readEntryPreferences())).toEqual({
      area,
      recent: [],
    });
    unsubscribe();
  });

  it("notifies subscribers and removes both event listeners on unsubscribe", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeEntryPreferences(onChange);

    window.dispatchEvent(new Event("localhub-entry-change"));
    window.dispatchEvent(new StorageEvent("storage"));
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
    window.dispatchEvent(new Event("localhub-entry-change"));
    window.dispatchEvent(new StorageEvent("storage"));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("keeps browsing usable when session storage reads or writes are blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is blocked", "SecurityError");
    });

    expect(readEntryPreferences()).toBe("");
    expect(() => saveEntryPreferences({ recent: [] })).not.toThrow();
  });
});
