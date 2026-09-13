/** Per-tab preferences only; never retain coordinates or send history to analytics. */
export const ENTRY_STORAGE_KEY = "localhub-entry-v1";
const CHANGE_EVENT = "localhub-entry-change";
export type EntryPreferences = {
  area?: { slug: string; name: string };
  recent: { market: string; query: string }[];
};
export function cleanEntryText(value: string, maximum = 160): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}
export function parseEntryPreferences(raw: string): EntryPreferences {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return { recent: [] };
    const value = data as Record<string, unknown>;
    const area = value.area as Record<string, unknown> | undefined;
    return {
      area:
        area &&
        typeof area.slug === "string" &&
        /^[a-z0-9-]*$/.test(area.slug) &&
        typeof area.name === "string"
          ? {
              slug: area.slug.slice(0, 80),
              name: cleanEntryText(area.name, 60),
            }
          : undefined,
      recent: Array.isArray(value.recent)
        ? value.recent
            .filter(
              (item): item is { market: string; query: string } =>
                Boolean(item) &&
                typeof item.market === "string" &&
                typeof item.query === "string",
            )
            .slice(0, 6)
            .map((item) => ({
              market: cleanEntryText(item.market, 80),
              query: cleanEntryText(item.query),
            }))
            .filter((item) => item.query)
        : [],
    };
  } catch {
    return { recent: [] };
  }
}
export function readEntryPreferences(): string {
  try {
    return sessionStorage.getItem(ENTRY_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}
export function subscribeEntryPreferences(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
export function saveEntryPreferences(preferences: EntryPreferences) {
  try {
    sessionStorage.setItem(
      ENTRY_STORAGE_KEY,
      JSON.stringify(parseEntryPreferences(JSON.stringify(preferences))),
    );
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* Browsing still works when storage is blocked. */
  }
}
