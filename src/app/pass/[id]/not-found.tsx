import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";
import { TicketCard } from "@/components/ui/TicketCard";
import { PASS_COPY } from "@/lib/pass/schema";

/** A pass id that isn't saved (expired after 30 days, or a wrong link): HTTP 404 with the honest copy. */
export default function PassNotFound() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-8 focus:outline-none">
      <TicketCard as="section" aria-labelledby="gone-title">
        <div className="flex flex-col gap-4">
          <h1 id="gone-title" className="text-3xl font-bold">
            No pass here
          </h1>
          <p>{PASS_COPY.passGone}</p>
          <Link href="/" className={buttonClassName("primary", "self-start")}>
            Make a pass
          </Link>
        </div>
      </TicketCard>
    </main>
  );
}
