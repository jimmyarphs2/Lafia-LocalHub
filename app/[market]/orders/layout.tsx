import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

export default function OrdersLayout({ children }: { children: ReactNode }) {
  return children;
}
