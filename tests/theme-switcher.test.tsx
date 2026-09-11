// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeSwitcher } from "@/components/theme-switcher";

const installMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      addEventListener: vi.fn(),
      matches,
      media: "(prefers-color-scheme: dark)",
      removeEventListener: vi.fn(),
    })),
  });
};

describe("ThemeSwitcher", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = "night";
    document.documentElement.dataset.themeChoice = "night";
    installMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("cycles through light and system themes while persisting the choice", () => {
    render(<ThemeSwitcher />);
    const switcher = screen.getByRole("button", {
      name: /night theme.*change colour theme/i,
    });

    fireEvent.click(switcher);
    expect(localStorage.getItem("localhub-theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(switcher);
    expect(localStorage.getItem("localhub-theme")).toBe("system");
    expect(document.documentElement.dataset.themeChoice).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("restores a saved theme without defaulting back to night", async () => {
    localStorage.setItem("localhub-theme", "light");
    render(<ThemeSwitcher />);

    expect(
      await screen.findByRole("button", {
        name: /light theme.*change colour theme/i,
      }),
    ).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("keeps switching themes when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(<ThemeSwitcher />);

    fireEvent.click(
      screen.getByRole("button", {
        name: /night theme.*change colour theme/i,
      }),
    );

    expect(document.documentElement.dataset.themeChoice).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
