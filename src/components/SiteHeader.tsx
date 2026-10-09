import Link from "next/link";
import { AccountMenu } from "@/components/account/AccountMenu";
import { Logo } from "@/components/site/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Home page section anchors (v0 nav). Plain links to "/#...", so they also work from /about and a pass page. */
export const HOME_SECTIONS = [
  // Kevin 2026-10-09: same order as the page ("What's a pass?" sits right under the hero).
  { href: "/#pass", label: "What's a pass?" },
  { href: "/#parks", label: "Explore" },
  { href: "/#why", label: "Why Grass Pass" },
] as const;

/**
 * Page tabs shown at every width (Kevin, 2026-10-06: a "How it works" tab that explains the app and the AI
 * process in detail, at /how-it-works; it replaces the "/#how" anchor in the header). Kevin 2026-10-06 (B2): the tab is "How it works" again
 * (it was "Real-World Data" for a few hours after his home copy).
 */
export const PAGE_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/about", label: "About" },
] as const;

/**
 * v3 site header (Kevin's v0 design): sticky, translucent meadow background, the ticket logo (home link,
 * never prefetched: SEC-3-01), the section links (from 1180 px; below that they wrapped to two lines each at ~1072 px), How it works and About (every width), sign-in and the dark mode switch (Kevin 2026-10-07: no "Make a pass" pill in the header).
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/85 backdrop-blur-md print:hidden">
      {/* Phones (under 640 px): the logo and the dark mode switch on top, the page tabs on a second row, so
          "How it works" and "About" stay visible without sideways scrolling (360 px measured). */}
      <div className="gp-container flex flex-wrap items-center gap-x-3 pt-1.5 max-sm:[--gp-gutter:1rem] max-[359px]:gap-x-2 sm:h-16 sm:flex-nowrap sm:gap-6 sm:pt-0">
        <Link href="/" prefetch={false} aria-label="Grass Pass home" className="inline-flex min-h-11 shrink-0 items-center rounded-md text-foreground">
          <Logo />
        </Link>
        <nav aria-label="Site" className="order-last flex basis-full items-center border-t border-border sm:order-none sm:ml-auto sm:basis-auto sm:border-0">
          <ul className="flex items-center gap-5 sm:gap-4 lg:gap-6">
            {HOME_SECTIONS.map((link) => (
              <li key={link.href} className="hidden min-[1180px]:block">
                <Link href={link.href} prefetch={false} className="inline-flex min-h-6 items-center text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground">
                  {link.label}
                </Link>
              </li>
            ))}
            {PAGE_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex min-h-11 items-center text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground sm:px-1.5 lg:min-h-6 lg:px-0"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2 max-[359px]:gap-1 sm:ml-0 sm:gap-3">
          <AccountMenu />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
