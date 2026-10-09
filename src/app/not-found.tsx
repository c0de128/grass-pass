import type { Metadata } from "next";
import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";
import { TicketCard } from "@/components/ui/TicketCard";

/** Review 2026-10-08 NIT-1: the tab said the home page's title on a 404. */
export const metadata: Metadata = { title: "Page not found · Grass Pass", robots: { index: false, follow: false } };

/** Any address that isn't a page here (HTTP 404). */
export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-14 focus:outline-none sm:py-20">
      <TicketCard as="section" aria-labelledby="nf-title">
        <div className="flex flex-col gap-4">
          <h1 id="nf-title" className="text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
            Page not found
          </h1>
          <p>There&apos;s no page at this address (maybe a typo). Good news: the parks are right where you left them.</p>
          <Link href="/" prefetch={false} className={buttonClassName("primary", "self-start")}>
            Make a pass
          </Link>
        </div>
      </TicketCard>
    </main>
  );
}
