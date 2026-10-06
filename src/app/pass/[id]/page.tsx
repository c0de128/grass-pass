import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { DifferentPassButton } from "@/components/pass/DifferentPassButton";
import { PassPreview } from "@/components/pass/PassPreview";
import { buttonClassName } from "@/components/ui/Button";
import { safeParkName } from "@/lib/ai/validate";
import { plausiblePassId } from "@/lib/limits/pass-read";
import { loadPass } from "@/lib/pass/make";
import { signInOptions } from "@/lib/accounts/config";
import { passItemStats } from "@/lib/reports/stats";
import { currentSession } from "@/lib/accounts/current";

/**
 * A saved pass, read from the pass cache only (never calls OpenStreetMap, iNaturalist or the model).
 * One store read per request: metadata and page share it (SEC-1-02). SEC-2-01: an id that can't exist
 * (bad park id shape, a day outside the 30-day pass TTL, a variant above 3) is a 404 with no store read,
 * and repeat reads are memoized in process (src/lib/limits/pass-read.ts).
 * Accounts: for a signed-in grown-up the report buttons show, with the item report counts (one more read
 * per park per 5 min per instance, src/lib/reports/stats.ts; the proxy charges it as COSTS.passStats).
 */
const getPass = cache((id: string) => (plausiblePassId(id, Date.now()) ? loadPass(id) : Promise.resolve(null)));

export async function generateMetadata(props: PageProps<"/pass/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const pass = await getPass(id);
  return {
    title: pass ? `Grass Pass for ${safeParkName(pass.park.name).name}` : "Grass Pass: pass not found",
    robots: { index: false, follow: false },
  };
}

export default async function PassPage(props: PageProps<"/pass/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const pass = await getPass(id);
  // Unknown or expired id: HTTP 404 with the honest "No pass here" copy (./not-found.tsx).
  if (!pass) notFound();
  const signedIn = (await currentSession()) !== null;
  // Report counts are shown to signed-in grown-ups (the ones who report); 1 read per park per 5 min.
  const stats = signedIn ? await passItemStats(pass) : {};

  return (
    <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-10 focus:outline-none sm:py-14">
      {/* Print first: on a phone the pass is long, and printing is the point (R1 judge/UX). */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Opens the one-page print layout, which opens the print dialog once (ADR 0004). */}
        <Link href={`/pass/${pass.id}/print?print=1`} prefetch={false} className={buttonClassName("primary")}>
          Print pass
        </Link>
        <p className="text-base text-muted-foreground">One black-and-white page. Cut it in two: the kid takes the top.</p>
      </div>
      <PassPreview pass={pass} reused={sp.reused === "1"} reports={{ signedIn, stats }} />
      <div className="flex flex-col gap-4">
        <DifferentPassButton
          parkId={pass.park.id}
          ageBand={pass.ageBand}
          variant={pass.variant}
          account={{ signedIn, options: signInOptions() }}
          returnTo={`/pass/${pass.id}`}
        />
        <Link href="/" prefetch={false} className={buttonClassName("secondary", "self-start")}>
          Pick another park
        </Link>
      </div>
    </main>
  );
}
