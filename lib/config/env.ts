import { z } from "zod";

const requiredPublicConfig =
  "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)";

export type PublicSupabaseConfig = {
  url: string;
  anonKey: string;
};

const urlSchema = z.string().trim().url();
const vercelHostnamePattern = /^(?:[a-z0-9-]+\.)*vercel\.app$/i;

function parseSafeUrl(value: string | undefined): URL | null {
  const parsed = urlSchema.safeParse(value?.trim());
  if (!parsed.success) return null;
  const url = new URL(parsed.data);
  const localHttp =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  return url.protocol === "https:" || localHttp ? url : null;
}

function getVercelPreviewAppUrl(): URL | null {
  if (process.env.VERCEL_ENV !== "preview") return null;

  const hostname =
    process.env.VERCEL_BRANCH_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (!hostname || !vercelHostnamePattern.test(hostname)) return null;

  return new URL(`https://${hostname}`);
}

/**
 * Hosted Supabase is optional during static builds and demo-only development.
 * Consumers must branch on null rather than silently using placeholder keys.
 */
export function getPublicSupabaseConfig(): PublicSupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) return null;

  if (!parseSafeUrl(url)) return null;

  return { url, anonKey };
}

export function assertPublicSupabaseConfig(): PublicSupabaseConfig {
  const config = getPublicSupabaseConfig();
  if (!config) {
    throw new Error(`Supabase is not configured. Set ${requiredPublicConfig}.`);
  }
  return config;
}

export function getAppUrl(): URL {
  // Server redirects in Vercel Preview must remain on the active branch. The
  // configured public URL is the Production canonical and may be shared with
  // Preview for metadata, so it is not a safe redirect origin there.
  const previewUrl = getVercelPreviewAppUrl();
  if (previewUrl) return previewUrl;

  const configuredUrl = parseSafeUrl(process.env.NEXT_PUBLIC_APP_URL);
  if (configuredUrl) {
    if (
      process.env.NODE_ENV === "production" &&
      configuredUrl.protocol !== "https:"
    ) {
      throw new Error("NEXT_PUBLIC_APP_URL must use HTTPS in production.");
    }
    return configuredUrl;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_APP_URL must be configured as a valid HTTPS URL in production.",
    );
  }

  return new URL("http://localhost:3000");
}

export function getAppOrigin(): string {
  return getAppUrl().origin;
}
