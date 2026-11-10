import type { MetadataRoute } from "next";

/**
 * Served at /manifest.webmanifest. The icons live in public/ because the
 * manifest needs stable URLs, unlike the hashed ones Next generates for
 * app/icon.svg.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GET TO IT — From 'I should' to 'I did.'",
    short_name: "GET TO IT",
    description:
      "Name what you've been putting off, break it into steps you can start today, and keep the work you've done.",
    start_url: "/",
    display: "standalone",
    background_color: "#fbf7f0",
    theme_color: "#fbf7f0",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
