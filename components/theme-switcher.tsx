"use client";

import { Laptop, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type ThemeChoice = "night" | "light" | "system";

const choices: readonly ThemeChoice[] = ["night", "light", "system"];

const labels: Record<ThemeChoice, string> = {
  night: "Night theme",
  light: "Light theme",
  system: "System theme",
};

function resolveTheme(choice: ThemeChoice) {
  if (choice !== "system") return choice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "night"
    : "light";
}

function readStoredTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem("localhub-theme");
    return choices.includes(stored as ThemeChoice)
      ? (stored as ThemeChoice)
      : "night";
  } catch {
    return "night";
  }
}

function applyTheme(choice: ThemeChoice) {
  document.documentElement.dataset.themeChoice = choice;
  document.documentElement.dataset.theme = resolveTheme(choice);
  try {
    localStorage.setItem("localhub-theme", choice);
  } catch {
    // The visual preference still works when browser storage is unavailable.
  }
}

export function ThemeSwitcher() {
  const [choice, setChoice] = useState<ThemeChoice>("night");

  useEffect(() => {
    const initial = readStoredTheme();
    applyTheme(initial);
    const frame = window.requestAnimationFrame(() => setChoice(initial));

    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => {
      if (readStoredTheme() === "system") {
        applyTheme("system");
      }
    };
    preference.addEventListener("change", syncSystemTheme);
    return () => {
      window.cancelAnimationFrame(frame);
      preference.removeEventListener("change", syncSystemTheme);
    };
  }, []);

  const Icon = choice === "night" ? Moon : choice === "light" ? Sun : Laptop;

  return (
    <button
      aria-label={`${labels[choice]}. Change colour theme.`}
      className="theme-switcher"
      onClick={() => {
        const next = choices[(choices.indexOf(choice) + 1) % choices.length];
        setChoice(next);
        applyTheme(next);
      }}
      title={`${labels[choice]} — select to change`}
      type="button"
    >
      <Icon aria-hidden="true" size={18} />
      <span>{choice}</span>
    </button>
  );
}
