import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Grass Pass",
    short_name: "Grass Pass",
    description: "Your ticket to get outside: printable park treasure hunts built from real park data.",
    start_url: "/",
    display: "standalone",
    background_color: "#FAF3E1",
    theme_color: "#295031",
    icons: [
      { src: "/favicon.ico", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
