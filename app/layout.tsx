import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";

import { getPublicAppUrl, isDemoMode } from "@/lib/market/public-url";

import "./globals.css";

const appUrl = getPublicAppUrl();
const demoMode = isDemoMode();

const manrope = Manrope({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-manrope",
});

const themeBootstrap = `(() => {
  try {
    const saved = localStorage.getItem("localhub-theme");
    const choice = ["night", "light", "system"].includes(saved) ? saved : "night";
    const resolved = choice === "system"
      ? (matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "light")
      : choice;
    document.documentElement.dataset.themeChoice = choice;
    document.documentElement.dataset.theme = resolved;
  } catch (_) {
    document.documentElement.dataset.themeChoice = "night";
    document.documentElement.dataset.theme = "night";
  }
})();`;

export const metadata: Metadata = {
  metadataBase: appUrl,
  title: {
    default: "LocalHub — Find what you need nearby",
    template: "%s | LocalHub",
  },
  description: demoMode
    ? "A guest-first local discovery directory using a fictional Lafia demonstration market."
    : "A guest-first local discovery directory for published nearby businesses.",
  applicationName: "LocalHub",
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "LocalHub",
    title: "LocalHub — Find what you need nearby",
    description: demoMode
      ? "Browse a fictional local directory demonstration without creating an account."
      : "Browse published nearby businesses without creating an account.",
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
  themeColor: "#071a38",
  colorScheme: "dark light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      className={manrope.variable}
      data-scroll-behavior="smooth"
      data-theme="night"
      data-theme-choice="night"
      lang="en-NG"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
