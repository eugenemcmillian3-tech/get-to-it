import type { Metadata, Viewport } from "next";
import "./globals.css";

const TITLE = "GET TO IT — From 'I should' to 'I did.'";
const DESCRIPTION =
  "Name what you've been putting off, break it into steps you can start today, and keep the work you've done.";

// Absolute URLs for share cards need a base. Vercel exposes the production
// domain to the build, so the live site is correct without hardcoding it, and
// a local build falls back to localhost.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "GET TO IT",
  openGraph: {
    type: "website",
    siteName: "GET TO IT",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fbf7f0",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
