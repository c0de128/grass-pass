import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { KidPass } from "@/components/pass/KidPass";
import { OctoberBox } from "@/components/pass/OctoberBox";
import { ParentStub, TearLine } from "@/components/pass/ParentStub";
import { PrintButton } from "@/components/pass/PrintButton";
import { PrintFit } from "@/components/pass/PrintFit";
import { buttonClassName } from "@/components/ui/Button";
import { TicketCard } from "@/components/ui/TicketCard";
import { isOctoberDay } from "@/lib/october";
import { loadPass } from "@/lib/pass/make";
import { PASS_COPY } from "@/lib/pass/schema";
import { siteUrl } from "@/lib/site-url";
import "@/styles/print.css";

/**
 * The printable pass (SPEC F6, ADR 0004): one US Letter sheet, black on white. Kid pass on top,
 * dashed tear line, parent stub below. Read from the pass cache only (never calls upstream).
 */
export async function generateMetadata(props: PageProps<"/pass/[id]/print">): Promise<Metadata> {
  const { id } = await props.params;
  const pass = await loadPass(id);
  return {
    title: pass ? `Print: Grass Pass for ${pass.park.name}` : "Grass Pass: pass not found",
    robots: { index: false, follow: false },
  };
}

/** The address printed on the stub: the configured site URL, else the host this page was served from. */
async function passUrl(id: string): Promise<string> {
  const configured = process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  let host = configured ? siteUrl().host : ((await headers()).get("host") ?? "");
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) host = siteUrl().host;
  return `${host}/pass/${id}`;
}

export default async function PrintPage(props: PageProps<"/pass/[id]/print">) {
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
    <main className="gp-print-page mx-auto w-full max-w-5xl flex-1 px-3 py-6 sm:px-5">
      <PrintFit />
      <div className="gp-screen-only mx-auto flex w-full max-w-[8.5in] flex-col gap-3">
        <p className="text-lg">
          This is your pass on one Letter page, in black and white. In the print box pick <strong>Scale: 100%</strong> (or
          &quot;Default&quot;). Then cut on the dashed line: the kid takes the top, you keep the answer key.
        </p>
        <div className="flex flex-wrap gap-3">
          <PrintButton auto={sp.print === "1"} />
          <Link href={`/pass/${pass.id}`} className={buttonClassName("secondary", "self-start")}>
            Back to the pass
          </Link>
        </div>
      </div>

      <article className="gp-sheet" aria-label={`Printable Grass Pass for ${pass.park.name}`}>
        <KidPass
          pass={pass}
          october={isOctoberDay(pass.day) ? <OctoberBox pass={pass} variant="print" headingLevel={2} /> : undefined}
        />
        <TearLine />
        <ParentStub pass={pass} passUrl={await passUrl(pass.id)} />
      </article>
    </main>
  );
}
