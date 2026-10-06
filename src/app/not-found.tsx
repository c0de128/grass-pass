import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";
import { TicketCard } from "@/components/ui/TicketCard";

/** Any address that isn't a page here (HTTP 404). */
export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-8 focus:outline-none">
      <TicketCard as="section" aria-labelledby="nf-title">
        <div className="flex flex-col gap-4">
          <h1 id="nf-title" className="text-3xl font-bold">
            Page not found
          </h1>
          <p>There is no page at this address. It may have been typed wrong.</p>
          <Link href="/" className={buttonClassName("primary", "self-start")}>
            Make a pass
          </Link>
        </div>
      </TicketCard>
    </main>
  );
}
