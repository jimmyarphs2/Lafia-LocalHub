import "server-only";

import { createClient } from "@supabase/supabase-js";
import { cache } from "react";

import { getPublicSupabaseConfig } from "@/lib/config/env";
import { getDemoArea } from "@/lib/location/lafia";
import { getLaunchMarket, getMarket } from "@/lib/market/config";
import { isDemoMode } from "@/lib/market/public-url";
import type { Database } from "@/lib/supabase/database.types";

export type EntryMarket = {
  slug: string;
  name: string;
  region: string;
  country: string;
  /** Approximate public area anchor, not a city boundary or user location. */
  coordinates?: { latitude: number; longitude: number };
};

export type EntryMarketsSnapshot = {
  markets: EntryMarket[];
  state: "ready" | "unavailable" | "not-configured";
  demoMode: boolean;
};

const MARKET_LIMIT = 100;
const LOCATION_LIMIT = 1_000;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PublicEntryMarketRow = Pick<
  Database["public"]["Tables"]["markets"]["Row"],
  "id" | "slug" | "name" | "country_code" | "is_active"
>;

function unavailable(
  state: "unavailable" | "not-configured",
): EntryMarketsSnapshot {
  return { markets: [], state, demoMode: false };
}

function boundedText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= maximumLength ? text : null;
}

function parseMarket(row: PublicEntryMarketRow): EntryMarket | null {
  const slug = boundedText(row.slug, 80);
  const name = boundedText(row.name, 120);
  const countryCode = boundedText(row.country_code, 2);
  if (
    row.is_active !== true ||
    !UUID_PATTERN.test(row.id) ||
    !slug ||
    !SLUG_PATTERN.test(slug) ||
    !name ||
    !countryCode ||
    !COUNTRY_CODE_PATTERN.test(countryCode)
  ) {
    return null;
  }

  const knownMarket = countryCode === "NG" ? getMarket(slug) : undefined;
  return {
    slug,
    name,
    // The hosted markets schema has no region field. Do not invent one.
    region: knownMarket?.region ?? "",
    country:
      new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode) ??
      countryCode,
  };
}

/**
 * Read only published market metadata using a stateless anonymous client.
 * The bounded directory does not assert seller availability or national coverage.
 * Coordinates are optional: the first valid active area is a suggestion anchor
 * only. Consumers must ask the user to confirm the suggested city.
 */
async function loadEntryMarkets(): Promise<EntryMarketsSnapshot> {
  if (isDemoMode()) {
    const { slug, name, region, country } = getLaunchMarket();
    return {
      state: "ready",
      demoMode: true,
      markets: [
        {
          slug,
          name,
          region,
          country,
          coordinates: { ...getDemoArea(slug).coordinates },
        },
      ],
    };
  }

  const config = getPublicSupabaseConfig();
  if (!config) return unavailable("not-configured");

  try {
    const client = createClient<Database>(config.url, config.anonKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    // Both reads share a deadline so location lookup cannot double the delay.
    const signal = AbortSignal.timeout(5_000);
    const marketResult = await client
      .from("markets")
      .select("id,slug,name,country_code,is_active")
      .eq("is_active", true)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .limit(MARKET_LIMIT)
      .abortSignal(signal);

    if (marketResult.error || !Array.isArray(marketResult.data)) {
      return unavailable("unavailable");
    }

    const marketById = new Map<string, EntryMarket>();
    const slugs = new Set<string>();
    for (const row of marketResult.data) {
      const market = parseMarket(row);
      if (!market || slugs.has(market.slug)) continue;
      marketById.set(row.id, market);
      slugs.add(market.slug);
    }

    // A successful empty response is known empty; malformed data is unknown.
    if (marketById.size === 0) {
      return marketResult.data.length === 0
        ? { markets: [], state: "ready", demoMode: false }
        : unavailable("unavailable");
    }

    const snapshot: EntryMarketsSnapshot = {
      state: "ready",
      demoMode: false,
      markets: [...marketById.values()].sort(
        (a, b) =>
          a.name.localeCompare(b.name, "en") ||
          a.slug.localeCompare(b.slug, "en"),
      ),
    };

    try {
      const locationResult = await client
        .from("market_locations")
        .select("id,market_id,latitude,longitude,is_active")
        .in("market_id", [...marketById.keys()])
        .eq("is_active", true)
        .order("market_id", { ascending: true })
        .order("id", { ascending: true })
        .limit(LOCATION_LIMIT)
        .abortSignal(signal);

      if (locationResult.error || !Array.isArray(locationResult.data)) {
        return snapshot;
      }

      for (const location of locationResult.data) {
        if (!location || typeof location !== "object") continue;
        const market = marketById.get(location.market_id);
        const { latitude, longitude } = location;
        if (
          market &&
          !market.coordinates &&
          location.is_active === true &&
          typeof latitude === "number" &&
          Number.isFinite(latitude) &&
          Math.abs(latitude) <= 90 &&
          typeof longitude === "number" &&
          Number.isFinite(longitude) &&
          Math.abs(longitude) <= 180
        ) {
          market.coordinates = { latitude, longitude };
        }
      }
    } catch {
      // Coordinate hints are optional. Keep confirmed cities usable manually.
      for (const market of snapshot.markets) delete market.coordinates;
    }

    return snapshot;
  } catch {
    // Do not fall back to fictional inventory after an outage or denied read.
    return unavailable("unavailable");
  }
}

export const getEntryMarkets = cache(loadEntryMarkets);
