import type { Metadata } from "next";
import Link from "next/link";
import { DifferentPassButton } from "@/components/pass/DifferentPassButton";
import { PassPreview } from "@/components/pass/PassPreview";
import { buttonClassName } from "@/components/ui/Button";
import { TicketCard } from "@/components/ui/TicketCard";
import { loadPass } from "@/lib/pass/make";
import { PASS_COPY } from "@/lib/pass/schema";

/** A saved pass, read from the pass cache only (never calls OpenStreetMap, iNaturalist or the model). */
export async function generateMetadata(props: PageProps<"/pass/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const pass = await loadPass(id);
  return {
    title: pass ? `Grass Pass for ${pass.park.name}` : "Grass Pass: pass not found",
    robots: { index: false, follow: false },
  };
}

export default async function PassPage(props: PageProps<"/pass/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const pass = await loadPass(id);

  if (!pass) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-8">
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

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-8">
      <PassPreview pass={pass} reused={sp.reused === "1"} />
      <div className="flex flex-col gap-4">
        {/* Opens the one-page print layout, which opens the print dialog once (ADR 0004). */}
        <Link href={`/pass/${pass.id}/print?print=1`} className={buttonClassName("primary", "self-start")}>
          Print pass
        </Link>
        <DifferentPassButton parkId={pass.park.id} ageBand={pass.ageBand} variant={pass.variant} />
        <Link href="/" className={buttonClassName("secondary", "self-start")}>
          Pick another park
        </Link>
      </div>
    </main>
  );
}
