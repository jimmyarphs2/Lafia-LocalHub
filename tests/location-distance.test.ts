import { describe, expect, it } from "vitest";
import { getDemoArea } from "@/lib/location/lafia";
import { haversineDistanceKm } from "@/lib/location/haversine";

describe("offline Haversine distance", () => {
  it("returns zero for the same point", () => {
    const lafia = getDemoArea("lafia").coordinates;
    expect(haversineDistanceKm(lafia, lafia)).toBe(0);
  });

  it("calculates the standard approximate distance for one latitude degree", () => {
    expect(
      haversineDistanceKm(
        { latitude: 0, longitude: 0 },
        { latitude: 1, longitude: 0 },
      ),
    ).toBeCloseTo(111.195, 2);
  });

  it("uses explicitly labelled fictional demo area anchors", () => {
    const area = getDemoArea("shendam-road");
    expect(area.label).toBe("Shendam Road");
    expect(area.coordinates).toEqual(
      expect.objectContaining({ latitude: expect.any(Number) }),
    );
  });
});
