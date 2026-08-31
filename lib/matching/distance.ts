import type { SearchIntent } from "@/lib/catalog/search";
import type { Listing } from "@/lib/catalog/data";
import { haversineDistanceKm } from "@/lib/location/haversine";

export type DistanceAssessment = {
  score: number | null;
  distanceKm: number | null;
  reason: string;
};

export function assessDemoDistance(
  intent: SearchIntent,
  listing: Listing,
): DistanceAssessment {
  const isFictionalDemo = listing.provenance?.kind === "fictional-demo";
  if (!intent.locationCoordinates) {
    return {
      score: null,
      distanceKm: null,
      reason: "No area was supplied, so distance did not affect this score.",
    };
  }
  if (!listing.coordinates) {
    return {
      score: null,
      distanceKm: null,
      reason:
        "No listing coordinates are published, so distance did not affect this score.",
    };
  }

  const rawDistance = haversineDistanceKm(
    intent.locationCoordinates,
    listing.coordinates,
  );
  const distanceKm = Math.round(rawDistance * 10) / 10;
  const score = Math.max(0, Math.round(100 - Math.min(rawDistance, 20) * 5));
  return {
    score,
    distanceKm,
    reason: isFictionalDemo
      ? `About ${distanceKm.toFixed(1)} km between approximate demo map points; not live navigation data.`
      : `About ${distanceKm.toFixed(1)} km between approximate listing coordinates; not live navigation data.`,
  };
}
