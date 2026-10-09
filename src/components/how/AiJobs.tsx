import { ArrowDown, Check, Code2, FileText, PenLine, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { clueExample, recordedDay, riddleExample, tipsExample, type Highlighted } from "@/lib/how/ai-examples";
import { REPO_URL } from "@/lib/site-url";

/**
 * "Where the AI is" (Kevin's Blueprint, 2026-10-09): each job the open model does, as a card with a REAL example in and
 * out, read from src/data/how/ai-examples.json (verbatim copies of recordings, re-checked against tests/fixtures by a
 * unit test). The "Code" lines are computed by the app's own check functions at build time (src/lib/how/ai-examples.ts).
 */

function Quoted({ h, fallback }: { h: Highlighted; fallback: string }) {
  if (!h) return <>{fallback}</>;
  return (
    <>
      {h.before}
      <mark className="rounded bg-sun px-0.5 text-sun-foreground [box-decoration-break:clone]">{h.quote}</mark>
      {h.after}
    </>
  );
}

function Part({ label, icon: Icon, tone, children }: { label: string; icon: LucideIcon; tone: "in" | "out" | "code"; children: ReactNode }) {
  const box =
    tone === "in"
      ? "bg-muted/70 ring-1 ring-border"
      : tone === "out"
        ? "bg-ai-soft text-ai-soft-foreground ring-2 ring-sun"
        : "gp-band bg-band text-band-foreground";
  const chip = tone === "in" ? "bg-primary text-primary-foreground" : tone === "out" ? "bg-sun text-sun-foreground" : "bg-band-foreground/15 text-band-foreground";
  return (
    <div className={`flex flex-col gap-2 rounded-2xl p-4 ${box}`}>
      <p className={`flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.7rem] font-bold tracking-wider uppercase ${chip}`}>
        <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
        {label}
      </p>
      {children}
    </div>
  );
}

/** The key under a fact: the marked words are the proof quote the model sent back. */
function QuoteKey({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p aria-hidden="true" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <span className="h-2.5 w-4 rounded-sm bg-sun" />
      The model&apos;s proof quote
    </p>
  );
}

function Arrow() {
  return (
    <span aria-hidden="true" className="-my-1.5 flex justify-center text-muted-foreground">
      <ArrowDown className="size-5" />
    </span>
  );
}

function CodeLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm leading-snug">
      <Check aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${ok ? "text-sun" : "opacity-0"}`} strokeWidth={3} />
      <span>{children}</span>
    </li>
  );
}

function Job({ n, title, children, park, band, day, fixture }: { n: number; title: string; children: ReactNode; park: string; band: string; day: string; fixture: string }) {
  return (
    <li id={`ai-job-${n}`} className="flex scroll-mt-28 flex-col gap-4 rounded-3xl bg-card p-5 shadow-lg ring-1 shadow-shadow/50 ring-border sm:p-6">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-sun font-heading text-lg font-extrabold text-sun-foreground">
          {n}
        </span>
        <h3 className="text-xl leading-tight font-extrabold text-ink">
          <span className="sr-only">Job {n}: </span>
          {title}
        </h3>
      </div>
      {children}
      <p className="mt-auto flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
        <FileText aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        <span>
          <span className="sr-only">Recorded at </span>
          {park}, {day}, ages {band} ·{" "}
          <a className="font-semibold text-link underline underline-offset-2" href={`${REPO_URL}/blob/main/${fixture}`}>
            Raw answer
          </a>
        </span>
      </p>
    </li>
  );
}

export function AiJobs() {
  const c = clueExample();
  const r = riddleExample();
  const t = tipsExample();
  const dropped = c.answerReturned - c.answerKept;
  return (
    <ol aria-label="The open model's three jobs, each with a real example" className="grid gap-5 lg:grid-cols-3">
      <Job n={1} title="Picks finds, writes clues" park={c.park} band={c.ageBand} day={recordedDay(c.recordedAt)} fixture={c.fixture}>
        <Part label={`In: ${c.factSource}`} icon={FileText} tone="in">
          <p className="text-sm leading-relaxed">
            <span className="sr-only">Fact, with the model&apos;s proof quote marked: </span>
            &ldquo;
            <Quoted h={c.highlight} fallback={c.inExcerpt} />
            &rdquo;
          </p>
          <QuoteKey show={c.highlight !== null} />
        </Part>
        <Arrow />
        <Part label={`Out: ${c.model}`} icon={PenLine} tone="out">
          <p className="font-heading text-lg leading-snug font-extrabold">&ldquo;{c.out.clue}&rdquo;</p>
        </Part>
        <Arrow />
        <Part label="Code" icon={Code2} tone="code">
          <ul className="flex flex-col gap-1.5">
            <CodeLine ok={c.grounded}>{c.grounded ? "Quote found, word for word." : "Quote not found: removed."}</CodeLine>
            {c.printed !== c.out.clue ? (
              <CodeLine ok>
                Prints: <q className="font-semibold">{c.printed}</q>
              </CodeLine>
            ) : null}
            <CodeLine ok>
              Removed {dropped} of {c.answerReturned} clues in this answer.
            </CodeLine>
          </ul>
        </Part>
      </Job>

      <Job n={2} title="Writes the riddle" park={r.park} band={r.ageBand} day={recordedDay(r.recordedAt)} fixture={r.fixture}>
        <Part label={`In: ${r.factSource}`} icon={FileText} tone="in">
          <p className="text-sm leading-relaxed">
            <span className="sr-only">Fact about the {r.factKind}, with the model&apos;s proof quote marked: </span>
            &ldquo;
            <Quoted h={r.highlight} fallback={r.inExcerpt} />
            &rdquo;
          </p>
          <QuoteKey show={r.highlight !== null} />
        </Part>
        <Arrow />
        <Part label={`Out: ${r.model}`} icon={PenLine} tone="out">
          <p className="font-heading text-lg leading-snug font-extrabold">&ldquo;{r.out.riddle}&rdquo;</p>
        </Part>
        <Arrow />
        <Part label="Code" icon={Code2} tone="code">
          <ul className="flex flex-col gap-1.5">
            <CodeLine ok>Picked the {r.factKind}, drew the map.</CodeLine>
            <CodeLine ok={r.grounded}>{r.grounded ? "Quote found, word for word." : "Quote not found: fixed riddle used."}</CodeLine>
          </ul>
        </Part>
      </Job>

      <Job n={3} title="Writes trip tips" park={t.park} band={t.ageBand} day={recordedDay(t.recordedAt)} fixture={t.fixture}>
        <Part label={`In: ${t.factSource}`} icon={FileText} tone="in">
          <p className="text-sm leading-relaxed">
            <span className="sr-only">Fact {t.factId}: </span>&ldquo;{t.inExcerpt}&rdquo;
          </p>
        </Part>
        <Arrow />
        <Part label={`Out: ${t.model}`} icon={PenLine} tone="out">
          <p className="font-heading text-lg leading-snug font-extrabold">&ldquo;{t.out.tip}&rdquo;</p>
          <p className="text-sm">
            Based on fact <code className="font-semibold">{t.out.factId}</code>
          </p>
        </Part>
        <Arrow />
        <Part label="Code" icon={Code2} tone="code">
          <ul className="flex flex-col gap-1.5">
            <CodeLine ok>Wrote the facts first.</CodeLine>
            <CodeLine ok>
              Kept {t.kept} of {t.returned} tips: each names a real fact.
            </CodeLine>
          </ul>
        </Part>
      </Job>
    </ol>
  );
}
