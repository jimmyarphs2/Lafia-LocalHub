import type { GeoPoint } from "./haversine";

export type DemoArea = {
  slug: string;
  label: string;
  aliases: readonly string[];
  coordinates: GeoPoint;
};

/** Approximate fictional-demo anchors used only by the offline matcher. */
export const LAFIA_DEMO_AREAS: readonly DemoArea[] = [
  {
    slug: "shendam-road",
    label: "Shendam Road",
    aliases: ["shendam road", "shendam rd"],
    coordinates: { latitude: 8.501, longitude: 8.521 },
  },
  {
    slug: "tudun-gwandara",
    label: "Tudun Gwandara",
    aliases: ["tudun gwandara", "gwandara"],
    coordinates: { latitude: 8.506, longitude: 8.5 },
  },
  {
    slug: "bukan-sidi",
    label: "Bukan Sidi",
    aliases: ["bukan sidi"],
    coordinates: { latitude: 8.486, longitude: 8.525 },
  },
  {
    slug: "makurdi-road",
    label: "Makurdi Road",
    aliases: ["makurdi road", "makurdi rd"],
    coordinates: { latitude: 8.479, longitude: 8.53 },
  },
  {
    slug: "jos-road",
    label: "Jos Road",
    aliases: ["jos road", "jos rd"],
    coordinates: { latitude: 8.515, longitude: 8.502 },
  },
  {
    slug: "lafia",
    label: "Lafia",
    aliases: ["lafia central", "lafia", "nasarawa"],
    coordinates: { latitude: 8.4939, longitude: 8.5153 },
  },
];

export function findDemoArea(normalizedQuery: string): DemoArea | undefined {
  return LAFIA_DEMO_AREAS.find((area) =>
    area.aliases.some((alias) => normalizedQuery.includes(alias)),
  );
}

export function getDemoArea(slug: string): DemoArea {
  const area = LAFIA_DEMO_AREAS.find((candidate) => candidate.slug === slug);
  if (!area) throw new Error(`Unknown fictional demo area: ${slug}`);
  return area;
}
