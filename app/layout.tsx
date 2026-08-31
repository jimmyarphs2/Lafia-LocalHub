import type { Metadata, Viewport } from "next";

import { getPublicAppUrl, isDemoMode } from "@/lib/market/public-url";

import "./globals.css";

const appUrl = getPublicAppUrl();
const demoMode = isDemoMode();

export const metadata: Metadata = {
  metadataBase: appUrl,
  title: {
    default: "LocalHub — Find what you need nearby",
    template: "%s | LocalHub",
  },
  description: demoMode
    ? "A guest-first local discovery directory using a fictional Lafia demonstration market."
    : "A guest-first local discovery directory for verified nearby businesses.",
  applicationName: "LocalHub",
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "LocalHub",
    title: "LocalHub — Find what you need nearby",
    description: demoMode
      ? "Browse a fictional local directory demonstration without creating an account."
      : "Browse verified nearby businesses without creating an account.",
  },
  twitter: {
    card: "summary",
    title: "LocalHub",
    description: "Find what you need nearby.",
  },
  robots: demoMode
    ? { index: false, follow: false }
    : { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-NG">
      <body>{children}</body>
    </html>
  );
}
