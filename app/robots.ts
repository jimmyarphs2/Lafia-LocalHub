import type { MetadataRoute } from "next";
import { getPublicUrl, isDemoMode } from "@/lib/market/public-url";
export default function robots(): MetadataRoute.Robots {
  if (isDemoMode()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/auth"] },
    sitemap: getPublicUrl("/sitemap.xml"),
  };
}
