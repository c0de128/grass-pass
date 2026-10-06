import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

// Fonts live in the repo (src/app/fonts: the @fontsource 5.3.0 latin woff2 files, SIL OFL 1.1, licences
// alongside), so neither the build nor the browser ever fetches Google Fonts.
// next/font/local names the font family after the const, so the consts are "Fredoka" / "Nunito": the same family
// names the Google Fonts loader produced before (computed styles and document.fonts still say Fredoka and Nunito).
const Fredoka = localFont({
  src: [
    { path: "./fonts/fredoka-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/fredoka-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-fredoka",
  display: "swap",
  fallback: ["ui-rounded", "system-ui", "sans-serif"],
});
const Nunito = localFont({
  src: [
    { path: "./fonts/nunito-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/nunito-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/nunito-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-nunito",
  display: "swap",
  fallback: ["ui-rounded", "system-ui", "sans-serif"],
});

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
    <html lang="en" className={`${Fredoka.variable} ${Nunito.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/* First Tab stop on every page (WCAG 2.4.1): every page has <main id="main">. */}
        <a
          href="#main"
          className="sr-only z-50 rounded-control bg-surface px-4 py-2 font-bold text-fg focus:not-sr-only focus:absolute focus:top-2 focus:left-2 print:hidden"
        >
          Skip to main content
        </a>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
