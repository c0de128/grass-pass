import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { KidPass } from "@/components/pass/KidPass";
import { OctoberBox, octoberStubText } from "@/components/pass/OctoberBox";
import { ParentStub, TearLine } from "@/components/pass/ParentStub";
import { PrintButton } from "@/components/pass/PrintButton";
import { PrintFit } from "@/components/pass/PrintFit";
import { SpotAnswer, SpotMap } from "@/components/pass/SpotMap";
import { buttonClassName } from "@/components/ui/Button";
import { isOctoberDay } from "@/lib/october";
import { safeParkName } from "@/lib/ai/validate";
import { loadPass } from "@/lib/pass/make";
import { withClearMap } from "@/lib/spot/redraw";
import { siteUrl } from "@/lib/site-url";
import "@/styles/print.css";

/**
 * The printable pass (SPEC F6, ADR 0004): one US Letter sheet, black on white. Kid pass on top,
 * dashed tear line, parent stub below. Read from the pass cache only (never calls upstream), once per
 * request (metadata and page share the read, SEC-1-02).
 */
// loadPass turns away ids that cannot exist (no store read) and opens pinned example passes (src/lib/pinned.ts).
// withClearMap: an older pass's Find This Spot map is redrawn framed on START and the X when the exact OSM answer it was
// drawn from is saved in the repo (src/lib/spot/redraw.ts; no extra store read, the stored pass is unchanged).
const getPass = cache(async (id: string) => {
  const pass = await loadPass(id);
  return pass ? withClearMap(pass) : null;
});

export async function generateMetadata(props: PageProps<"/pass/[id]/print">): Promise<Metadata> {
  const { id } = await props.params;
  const pass = await getPass(id);
  return {
    title: pass ? `Print: Grass Pass for ${safeParkName(pass.park.name).name}` : "Grass Pass: pass not found",
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
  const pass = await getPass(id);

  // Unknown or expired id: HTTP 404 with the honest "No pass here" copy (../not-found.tsx).
  if (!pass) notFound();

  const spot = pass.spot?.status === "ok" ? pass.spot : null;
  const octoberText = octoberStubText(pass);

  return (
    <main id="main" tabIndex={-1} className="gp-print-page mx-auto w-full max-w-5xl flex-1 px-3 py-6 focus:outline-none sm:px-5">
      <PrintFit />
      <div className="gp-screen-only mx-auto flex w-full max-w-[8.5in] flex-col gap-3">
        <p className="text-lg">
          One black-and-white Letter page. In the print box, pick <strong>Scale: 100%</strong> or &quot;Default&quot;. Cut
          on the dashed line: kid gets the hunt, you keep the answer key.
        </p>
        <div className="flex flex-wrap gap-3">
          <PrintButton auto={sp.print === "1"} />
          <Link href={`/pass/${pass.id}`} prefetch={false} className={buttonClassName("secondary", "self-start")}>
            Back to the pass
          </Link>
        </div>
      </div>

      <article className="gp-sheet" aria-label={`Printable Grass Pass for ${safeParkName(pass.park.name).name}`}>
        <KidPass
          pass={pass}
          spot={spot ? <SpotMap spot={spot} parkName={safeParkName(pass.park.name).name} variant="print" headingLevel={2} /> : undefined}
          october={isOctoberDay(pass.day) ? <OctoberBox pass={pass} variant="print" headingLevel={2} /> : undefined}
        />
        <TearLine />
        <ParentStub
          pass={pass}
          passUrl={await passUrl(pass.id)}
          spotAnswer={spot ? <SpotAnswer spot={spot} /> : undefined}
          october={octoberText ?? undefined}
        />
      </article>
    </main>
  );
}
