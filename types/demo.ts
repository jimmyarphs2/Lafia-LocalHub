export const DEMO_SOURCE_KINDS = ["demo_fixture"] as const;

export type DemoSourceKind = (typeof DEMO_SOURCE_KINDS)[number];

export interface DemoProvenance {
  source: DemoSourceKind;
  datasetId: string;
  datasetVersion: string;
  fictional: true;
  realWorldVerified: false;
  locationAccuracy: "approximate" | "not_applicable";
  notice: string;
}

export interface DemoSeedMetadata {
  id: string;
  version: string;
  generatedAt: string;
  citySlug: string;
  deterministic: true;
  notice: string;
}
