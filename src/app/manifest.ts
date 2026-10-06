import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Grass Pass",
    short_name: "Grass Pass",
    description: "Your ticket to get outside: one-page park passes that Gemma 4 writes from each park's real map and wildlife sightings.",
    start_url: "/",
    display: "standalone",
    background_color: "#EEF3E2",
    theme_color: "#10291A",
    icons: [
      { src: "/favicon.ico", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
