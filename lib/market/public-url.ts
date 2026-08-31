const developmentOrigin = "http://localhost:3000";

function isBuildPhase() {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/**
 * Returns the single public origin used for canonical URLs and crawl metadata.
 * A localhost fallback is deliberately limited to development and static builds.
 */
export function getPublicAppUrl(): URL {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const liveMode = !isDemoMode();

  if (!configuredOrigin) {
    if (liveMode) {
      throw new Error(
        "NEXT_PUBLIC_APP_URL must be configured when demo mode is disabled.",
      );
    }
    if (process.env.NODE_ENV === "development" || isBuildPhase()) {
      return new URL(developmentOrigin);
    }
    throw new Error("NEXT_PUBLIC_APP_URL must be configured in production.");
  }

  let url: URL;
  try {
    url = new URL(configuredOrigin);
  } catch {
    throw new Error("NEXT_PUBLIC_APP_URL must be a valid absolute URL.");
  }

  if (liveMode && url.protocol !== "https:") {
    throw new Error(
      "NEXT_PUBLIC_APP_URL must use HTTPS when demo mode is disabled.",
    );
  }

  return url;
}

export function getPublicUrl(pathname: string): string {
  return new URL(pathname, getPublicAppUrl()).toString();
}

export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
}
