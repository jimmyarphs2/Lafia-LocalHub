import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getConfig: vi.fn(),
  isDemoMode: vi.fn(),
  getCatalog: vi.fn(),
  notFound: vi.fn(),
  marketShell: vi.fn(),
  catalogNotice: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/config/env", () => ({
  getPublicSupabaseConfig: mocks.getConfig,
}));
vi.mock("@/lib/market/public-url", () => ({
  isDemoMode: mocks.isDemoMode,
  getPublicUrl: (pathname: string) => `https://localhub.example${pathname}`,
}));
vi.mock("@/lib/catalog/source", () => ({
  getCatalogForMarket: mocks.getCatalog,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/components/market-shell", () => ({
  MarketShell: mocks.marketShell,
}));
vi.mock("@/components/catalog-ui", () => ({
  CatalogStateNotice: mocks.catalogNotice,
}));

import MarketLayout, { generateMetadata } from "@/app/[market]/layout";
import { getEntryMarkets } from "@/lib/market/entry-markets";

const lafiaId = "11111111-1111-4111-8111-111111111111";
const abujaId = "22222222-2222-4222-8222-222222222222";
const lafia = {
  id: lafiaId,
  slug: "lafia",
  name: "Lafia",
  country_code: "NG",
  is_active: true,
};
const abuja = { ...lafia, id: abujaId, slug: "abuja", name: "Abuja" };
const anchor = {
  id: "33333333-3333-4333-8333-333333333333",
  market_id: lafiaId,
  latitude: 8.4939,
  longitude: 8.5153,
  is_active: true,
};

function queryResult(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    abortSignal: vi.fn<
      (signal: AbortSignal) => Promise<{ data: unknown; error: unknown }>
    >(async () => ({ data, error })),
  };
  return query;
}

function setupQueries(
  markets: unknown = [lafia],
  locations: unknown = [anchor],
) {
  const queries = {
    markets: queryResult(markets),
    market_locations: queryResult(locations),
  };
  const from = vi.fn((table: keyof typeof queries) => queries[table]);
  mocks.createClient.mockReturnValue({ from });
  return { queries, from };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.isDemoMode.mockReturnValue(false);
  mocks.getConfig.mockReturnValue({
    url: "https://project.supabase.co",
    anonKey: "public-publishable-key",
  });
  mocks.notFound.mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
});

describe("published market route admission", () => {
  const params = (market: string) => Promise.resolve({ market });

  it("keeps the existing Lafia shell without an extra admission lookup", async () => {
    const result = await MarketLayout({
      params: params("lafia"),
      children: "directory",
    });
    expect(result.type).toBe(mocks.marketShell);
    expect(result.props.market.slug).toBe("lafia");
    expect(mocks.getCatalog).not.toHaveBeenCalled();
  });

  it("admits and labels an exact published non-Lafia market in live mode", async () => {
    mocks.getCatalog.mockResolvedValue({
      state: "ready",
      source: "supabase",
      market: { slug: "abuja", name: "Abuja", countryCode: "NG" },
    });
    const result = await MarketLayout({
      params: params("abuja"),
      children: "directory",
    });
    expect(result.type).toBe(mocks.marketShell);
    expect(result.props.market).toEqual({
      slug: "abuja",
      name: "Abuja",
      region: "",
      country: "Nigeria",
      description: "Discover published local businesses in Abuja.",
    });
    expect(mocks.getCatalog).toHaveBeenCalledWith("abuja");
    await expect(
      generateMetadata({ params: params("abuja") }),
    ).resolves.toMatchObject({
      title: "Abuja directory",
      alternates: { canonical: "https://localhub.example/abuja" },
    });
  });

  it("does not fabricate additional demo cities or admit malformed paths", async () => {
    mocks.isDemoMode.mockReturnValue(true);
    await expect(
      MarketLayout({ params: params("abuja"), children: null }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    mocks.isDemoMode.mockReturnValue(false);
    await expect(
      MarketLayout({ params: params("../admin"), children: null }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getCatalog).not.toHaveBeenCalled();
  });

  it("distinguishes an unpublished city from a catalog outage", async () => {
    mocks.getCatalog.mockResolvedValue({ state: "market-unpublished" });
    await expect(
      MarketLayout({ params: params("abuja"), children: null }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    mocks.getCatalog.mockResolvedValue({ state: "unavailable" });
    const result = await MarketLayout({
      params: params("abuja"),
      children: "not falsely shown as an empty market",
    });
    expect(result.type).toBe("main");
    expect(result.props.children[1].type).toBe(mocks.catalogNotice);
    expect(result.props.children[1].props.state).toBe("unavailable");
    await expect(
      generateMetadata({ params: params("abuja") }),
    ).resolves.toMatchObject({
      title: "Directory temporarily unavailable",
      robots: { index: false, follow: false },
    });
  });

  it("does not accept an unexpected cross-market response", async () => {
    mocks.getCatalog.mockResolvedValue({
      state: "ready",
      market: { slug: "lafia", name: "Lafia", countryCode: "NG" },
    });
    const result = await MarketLayout({
      params: params("abuja"),
      children: null,
    });
    expect(result.type).toBe("main");
    expect(result.props.children[1].props.state).toBe("unavailable");
  });
});

describe("entry market directory", () => {
  it("returns only the existing fictional Lafia market in demo mode", async () => {
    mocks.isDemoMode.mockReturnValue(true);

    await expect(getEntryMarkets()).resolves.toEqual({
      state: "ready",
      demoMode: true,
      markets: [
        {
          slug: "lafia",
          name: "Lafia",
          region: "Nasarawa State",
          country: "Nigeria",
          coordinates: { latitude: 8.4939, longitude: 8.5153 },
        },
      ],
    });
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("does not substitute demo cities when live config is missing", async () => {
    mocks.getConfig.mockReturnValue(null);
    await expect(getEntryMarkets()).resolves.toEqual({
      state: "not-configured",
      demoMode: false,
      markets: [],
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("reads active market metadata through the anonymous RLS boundary", async () => {
    const { queries, from } = setupQueries([lafia, abuja]);
    await expect(getEntryMarkets()).resolves.toEqual({
      state: "ready",
      demoMode: false,
      markets: [
        { slug: "abuja", name: "Abuja", region: "", country: "Nigeria" },
        {
          slug: "lafia",
          name: "Lafia",
          region: "Nasarawa State",
          country: "Nigeria",
          coordinates: { latitude: 8.4939, longitude: 8.5153 },
        },
      ],
    });
    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "public-publishable-key",
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
    expect(from.mock.calls).toEqual([["markets"], ["market_locations"]]);
    expect(queries.markets.eq).toHaveBeenCalledWith("is_active", true);
    expect(queries.markets.limit).toHaveBeenCalledWith(100);
    expect(queries.market_locations.in).toHaveBeenCalledWith("market_id", [
      lafiaId,
      abujaId,
    ]);
    expect(queries.market_locations.eq).toHaveBeenCalledWith("is_active", true);
    expect(queries.market_locations.limit).toHaveBeenCalledWith(1_000);
    expect(queries.markets.abortSignal.mock.calls[0][0]).toBe(
      queries.market_locations.abortSignal.mock.calls[0][0],
    );
    const source = readFileSync(
      resolve(process.cwd(), "lib/market/entry-markets.ts"),
      "utf8",
    );
    expect(source).not.toContain("@/lib/supabase/admin");
    expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(source).not.toContain("getServerSupabaseClient");
  });

  it("keeps legitimate empty directories separate from unknown data", async () => {
    const { from } = setupQueries([], []);
    await expect(getEntryMarkets()).resolves.toEqual({
      state: "ready",
      demoMode: false,
      markets: [],
    });
    expect(from).toHaveBeenCalledTimes(1);

    setupQueries(null);
    await expect(getEntryMarkets()).resolves.toMatchObject({
      state: "unavailable",
      markets: [],
    });
  });

  it("never turns a denied read or provider exception into a demo fallback", async () => {
    const { queries } = setupQueries();
    queries.markets.abortSignal.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });
    await expect(getEntryMarkets()).resolves.toEqual({
      state: "unavailable",
      demoMode: false,
      markets: [],
    });

    mocks.createClient.mockImplementation(() => {
      throw new Error("network failed");
    });
    await expect(getEntryMarkets()).resolves.toMatchObject({
      state: "unavailable",
      demoMode: false,
      markets: [],
    });
  });

  it("retains confirmed cities for manual selection when coordinates fail", async () => {
    const { queries } = setupQueries();
    queries.market_locations.abortSignal.mockResolvedValue({
      data: null,
      error: { message: "timeout" },
    });
    await expect(getEntryMarkets()).resolves.toEqual({
      state: "ready",
      demoMode: false,
      markets: [
        {
          slug: "lafia",
          name: "Lafia",
          region: "Nasarawa State",
          country: "Nigeria",
        },
      ],
    });
  });

  it("retains confirmed cities if coordinate lookup rejects or is malformed", async () => {
    const { queries } = setupQueries();
    queries.market_locations.abortSignal.mockRejectedValue(
      new Error("timeout"),
    );
    const rejected = await getEntryMarkets();
    expect(rejected.state).toBe("ready");
    expect(rejected.markets[0].slug).toBe("lafia");
    expect(rejected.markets[0]).not.toHaveProperty("coordinates");

    setupQueries([lafia], null);
    const malformed = await getEntryMarkets();
    expect(malformed.state).toBe("ready");
    expect(malformed.markets[0]).not.toHaveProperty("coordinates");
  });

  it("drops inactive, malformed, and duplicate public market rows", async () => {
    setupQueries([
      { ...lafia, slug: "../admin" },
      { ...lafia, id: "not-a-uuid" },
      { ...lafia, name: " " },
      { ...lafia, name: "x".repeat(121) },
      { ...lafia, slug: "x".repeat(81) },
      { ...lafia, is_active: false },
      { ...lafia, country_code: "ng" },
      lafia,
      { ...lafia, id: abujaId },
    ]);
    const snapshot = await getEntryMarkets();
    expect(snapshot.state).toBe("ready");
    expect(snapshot.markets).toHaveLength(1);
    expect(snapshot.markets[0].slug).toBe("lafia");

    setupQueries([{ ...lafia, slug: "../admin" }]);
    await expect(getEntryMarkets()).resolves.toMatchObject({
      state: "unavailable",
      markets: [],
    });
  });

  it("uses only the first finite, active, same-market coordinate", async () => {
    setupQueries(
      [lafia],
      [
        { ...anchor, market_id: abujaId },
        { ...anchor, is_active: false },
        { ...anchor, latitude: null },
        { ...anchor, latitude: Number.NaN },
        { ...anchor, latitude: 91 },
        { ...anchor, longitude: Number.POSITIVE_INFINITY },
        { ...anchor, longitude: -181 },
        anchor,
        { ...anchor, latitude: 9, longitude: 9 },
      ],
    );
    const snapshot = await getEntryMarkets();
    expect(snapshot.markets[0].coordinates).toEqual({
      latitude: 8.4939,
      longitude: 8.5153,
    });
  });

  it("allows manual market selection when no valid coordinates exist", async () => {
    setupQueries([lafia], [{ ...anchor, latitude: null, longitude: null }]);
    const snapshot = await getEntryMarkets();
    expect(snapshot.state).toBe("ready");
    expect(snapshot.markets[0]).not.toHaveProperty("coordinates");
  });
});
