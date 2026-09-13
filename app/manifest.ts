import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LocalHub",
    short_name: "LocalHub",
    description: "Find trusted local businesses, products, and services.",
    start_url: "/lafia",
    display: "standalone",
    background_color: "#071a38",
    theme_color: "#071a38",
    orientation: "portrait-primary",
    categories: ["business", "shopping", "lifestyle"],
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
