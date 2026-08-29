import type { DemoProvenance } from "./demo";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface City {
  id: string;
  slug: string;
  name: string;
  state: string;
  countryCode: "NG";
  center: Coordinates;
  timezone: "Africa/Lagos";
  isActive: boolean;
}

export interface Area {
  id: string;
  cityId: string;
  slug: string;
  name: string;
  aliases: readonly string[];
  center: Coordinates;
  provenance?: DemoProvenance;
}

export interface BusinessLocation {
  cityId: string;
  cityName: string;
  areaId: string;
  areaName: string;
  addressLine: string;
  coordinates: Coordinates;
  isApproximate: boolean;
}

export interface ResolvedLocation {
  label: string;
  city: City;
  area: Area | null;
  coordinates: Coordinates;
  source: "area_alias" | "city_default" | "coordinates";
  isApproximate: boolean;
}

export interface LocationService {
  resolve(locationText?: string | null): ResolvedLocation;
  distanceKm(from: Coordinates, to: Coordinates): number;
}
