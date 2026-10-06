import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { DifferentPassButton } from "@/components/pass/DifferentPassButton";
import { PassPreview } from "@/components/pass/PassPreview";
import { buttonClassName } from "@/components/ui/Button";
import { loadPass } from "@/lib/pass/make";

/**
 * A saved pass, read from the pass cache only (never calls OpenStreetMap, iNaturalist or the model).
 * One store read per request: metadata and page share it (SEC-1-02).
 */
const getPass = cache((id: string) => loadPass(id));

export async function generateMetadata(props: PageProps<"/pass/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const pass = await getPass(id);
  return {
    title: pass ? `Grass Pass for ${pass.park.name}` : "Grass Pass: pass not found",
    robots: { index: false, follow: false },
  };
}

export default async function PassPage(props: PageProps<"/pass/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const pass = await getPass(id);
  // Unknown or expired id: HTTP 404 with the honest "No pass here" copy (./not-found.tsx).
  if (!pass) notFound();

  return (
    <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-8 focus:outline-none">
      {/* Print first: on a phone the pass is long, and printing is the point (R1 judge/UX). */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Opens the one-page print layout, which opens the print dialog once (ADR 0004). */}
        <Link href={`/pass/${pass.id}/print?print=1`} className={buttonClassName("primary")}>
          Print pass
        </Link>
        <p className="text-base">One black-and-white page. Cut it in two: the kid takes the top.</p>
      </div>
      <PassPreview pass={pass} reused={sp.reused === "1"} />
      <div className="flex flex-col gap-4">
        <DifferentPassButton parkId={pass.park.id} ageBand={pass.ageBand} variant={pass.variant} />
        <Link href="/" className={buttonClassName("secondary", "self-start")}>
          Pick another park
        </Link>
      </div>
    </main>
  );
}
