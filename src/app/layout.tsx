import type { Metadata, Viewport } from "next";
import { Fredoka, Nunito } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

// Self-hosted at build time by next/font (no requests to Google from the browser). Both OFL.
const fredoka = Fredoka({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-fredoka", display: "swap" });
const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-nunito", display: "swap" });

const TITLE = "Grass Pass: your ticket to get outside";
const DESCRIPTION =
  "Pick a park, print a pass, put the phone away. A printable scavenger pass built from real, dated data about that park.";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Grass Pass",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/icon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    siteName: "Grass Pass",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og-1200x630.png", width: 1200, height: 630, alt: "Grass Pass logo: a green ticket growing grass, next to a kid with a magnifying glass" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og-1200x630.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF3E1" },
    { media: "(prefers-color-scheme: dark)", color: "#295031" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fredoka.variable} ${nunito.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
