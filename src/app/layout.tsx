import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

// Fonts live in the repo (src/app/fonts, SIL OFL 1.1, licences alongside), so neither the build nor the browser
// ever fetches Google Fonts.
// Site (v3, Kevin's v0 design): Bricolage Grotesque (headings) + DM Sans (body), the @fontsource-variable 5.3.0
// latin "wght" files (one variable file each, weights 200-800 / 100-1000).
// next/font/local names the family after the const, so the consts are the real family names.
const BricolageGrotesque = localFont({
  src: [{ path: "./fonts/bricolage-grotesque-latin-wght-normal.woff2", weight: "200 800", style: "normal" }],
  variable: "--font-bricolage",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});
const DMSans = localFont({
  src: [{ path: "./fonts/dm-sans-latin-wght-normal.woff2", weight: "100 1000", style: "normal" }],
  variable: "--font-dm-sans",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});
// The PRINTED pass keeps its own type (print.css: Fredoka headings, Nunito text), so its one-page fit is unchanged.
// Not preloaded: only the print page uses them, and the browser fetches a font face only when a page uses it.
const Fredoka = localFont({
  src: [
    { path: "./fonts/fredoka-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/fredoka-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-fredoka",
  display: "swap",
  preload: false,
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
  preload: false,
  fallback: ["ui-rounded", "system-ui", "sans-serif"],
});

const TITLE = "Grass Pass: Gemma 4 reads your park and writes a one-page pass";
const DESCRIPTION =
  "Pick a park and your kid's age. Gemma 4, an open-weight AI model, reads that park's map and the last 14 days of wildlife sightings and writes a one-page pass to print. Code checks every clue against its source.";

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
    images: [{ url: "/og-1200x630.png", width: 1200, height: 630, alt: "Grass Pass: a green ticket with a sprout, the words \"Your ticket to get outside.\" and a sketch of a one-page pass" }],
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
    { media: "(prefers-color-scheme: light)", color: "#EEF3E2" },
    { media: "(prefers-color-scheme: dark)", color: "#0D1A11" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${BricolageGrotesque.variable} ${DMSans.variable} ${Fredoka.variable} ${Nunito.variable} h-full scroll-smooth antialiased`}>
      <body className="flex min-h-full flex-col">
        {/* First Tab stop on every page (WCAG 2.4.1): every page has <main id="main">. */}
        <a
          href="#main"
          className="sr-only z-50 rounded-full bg-card px-4 py-2 font-bold text-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 print:hidden"
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
