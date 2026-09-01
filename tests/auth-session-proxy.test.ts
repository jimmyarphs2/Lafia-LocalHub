import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getPublicSupabaseConfig: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock("@/lib/config/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/env")>()),
  getPublicSupabaseConfig: mocks.getPublicSupabaseConfig,
}));

import { refreshSupabaseSession } from "@/lib/supabase/proxy";

describe("Supabase session refresh proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicSupabaseConfig.mockReturnValue({
      url: "https://example.supabase.co",
      anonKey: "publishable-test",
    });
  });

  it("propagates refreshed cookies and private no-store headers", async () => {
    mocks.createServerClient.mockImplementation(
      (
        _url: string,
        _key: string,
        options: {
          cookies: {
            setAll: (
              values: {
                name: string;
                value: string;
                options: Record<string, unknown>;
              }[],
              headers: Record<string, string>,
            ) => void;
          };
        },
      ) => ({
        auth: {
          getUser: async () => {
            options.cookies.setAll(
              [
                {
                  name: "sb-example-auth-token",
                  value: "refreshed",
                  options: { httpOnly: true, sameSite: "lax", path: "/" },
                },
              ],
              {
                "Cache-Control":
                  "private, no-cache, no-store, must-revalidate, max-age=0",
                Expires: "0",
                Pragma: "no-cache",
              },
            );
            return { data: { user: { id: "user-1" } }, error: null };
          },
        },
      }),
    );

    const request = new NextRequest("https://localhub.com.ng/lafia", {
      headers: { cookie: "sb-example-auth-token=stale" },
    });
    const response = await refreshSupabaseSession(request);

    expect(response.cookies.get("sb-example-auth-token")?.value).toBe(
      "refreshed",
    );
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
    expect(mocks.createServerClient.mock.calls[0]?.[2]).toMatchObject({
      auth: { experimental: { appendPkceFlowIdToRedirects: true } },
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
    });
  });

  it("preserves navigation when the auth provider is temporarily unavailable", async () => {
    mocks.createServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => Promise.reject(new Error("offline"))),
      },
    });

    const response = await refreshSupabaseSession(
      new NextRequest("https://localhub.com.ng/lafia"),
    );

    expect(response.status).toBe(200);
    expect(response.cookies.getAll()).toHaveLength(0);
  });
});
