import {
  Binoculars,
  Braces,
  BookOpen,
  Cloud,
  CloudSun,
  Database,
  Dog,
  KeyRound,
  ListChecks,
  Map as MapIcon,
  MapPinned,
  PenLine,
  Printer,
  Server,
  ShieldCheck,
  Siren,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { MAX_MODEL_CALLS } from "@/lib/ai/build-pass";
import { services, type Service } from "@/lib/how/services";

/**
 * The /how-it-works centrepiece (Kevin's "Blueprint", 2026-10-09): every outside service the app uses, grouped, with
 * data flowing left to right into the printed pass (top to bottom below 1280 px). It is real HTML: an ordered list of
 * five stages, each with its own heading and list, so screen readers get the same flow as text. The arrows, grid and
 * paper art are decorative (aria-hidden). Every service name comes from src/lib/how/services.ts; every number from code.
 */

const SERVICE_ICON: Record<string, LucideIcon> = {
  osm: MapIcon,
  inat: Binoculars,
  wikipedia: BookOpen,
  serpapi: Dog,
  "open-meteo": CloudSun,
  nws: Siren,
  digitalocean: Cloud,
  vercel: Server,
  upstash: Database,
  authjs: KeyRound,
};

type Tone = "data" | "code" | "model" | "paper";

const STAGE_LABEL: Record<Tone, string> = { data: "Real data", code: "Code", model: "Open model · only AI step", paper: "Paper" };

/** One arrow to the next stage: down on phones and tablets, right from 1280 px. The dashes drift only when motion is OK. */
function Flow({ hot = false }: { hot?: boolean }) {
  const stroke = hot ? "stroke-ink" : "stroke-muted-foreground";
  return (
    <span aria-hidden="true" className="pointer-events-none absolute z-20 flex items-center justify-center max-xl:-bottom-10 max-xl:left-1/2 max-xl:h-10 max-xl:w-8 max-xl:-translate-x-1/2 xl:top-1/2 xl:-right-10 xl:h-8 xl:w-10 xl:-translate-y-1/2">
      <svg viewBox="0 0 16 40" className="h-full xl:hidden" fill="none">
        <path d="M8 2 V32" className={`gp-how-flow ${stroke}`} strokeWidth="2.5" strokeDasharray="4 5" strokeLinecap="round" />
        <path d="M2.5 28 L8 36 L13.5 28" className={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg viewBox="0 0 40 16" className="hidden w-full xl:block" fill="none">
        <path d="M2 8 H32" className={`gp-how-flow ${stroke}`} strokeWidth="2.5" strokeDasharray="4 5" strokeLinecap="round" />
        <path d="M28 2.5 L36 8 L28 13.5" className={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

const STAGE_BOX: Record<Tone, string> = {
  data: "bg-card text-card-foreground ring-1 ring-border shadow-lg shadow-shadow/50",
  code: "gp-band bg-band text-band-foreground shadow-lg shadow-shadow/60",
  model: "bg-sun text-sun-foreground shadow-2xl shadow-shadow ring-4 ring-sun/30",
  paper: "bg-card text-card-foreground ring-1 ring-border shadow-lg shadow-shadow/50",
};

const CHIP: Record<Tone, string> = {
  data: "bg-primary text-primary-foreground",
  code: "bg-band-foreground/15 text-band-foreground",
  model: "bg-sun-foreground text-sun",
  paper: "bg-muted text-ink",
};

function Stage({ n, tone, title, children, last = false, hotArrow = false, className = "", service }: { n: number; tone: Tone; title: string; children: ReactNode; last?: boolean; hotArrow?: boolean; className?: string; service?: string }) {
  return (
    <li className={`relative flex min-w-0 flex-col ${className}`} data-stage={tone} data-service={service}>
      <div className={`relative flex h-full flex-col gap-4 rounded-3xl p-5 ${STAGE_BOX[tone]}`}>
        <div className="flex flex-col gap-2">
          <p className={`flex w-fit items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-1 text-[0.7rem] font-bold tracking-wider uppercase ${CHIP[tone]}`}>
            <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-black/15 font-heading text-[0.7rem]">
              {n}
            </span>
            <span>
              <span className="sr-only">Stage {n}: </span>
              {STAGE_LABEL[tone]}
            </span>
          </p>
          <h3 className={`font-extrabold leading-tight ${tone === "model" ? "text-2xl 2xl:text-3xl" : "text-lg 2xl:text-xl"}`}>{title}</h3>
        </div>
        {children}
      </div>
      {last ? null : <Flow hot={hotArrow} />}
    </li>
  );
}

function ServiceChip({ s, compact = false }: { s: Service; compact?: boolean }) {
  const Icon = SERVICE_ICON[s.id] ?? Database;
  return (
    <li className={`flex items-start gap-3 rounded-2xl bg-muted/70 ring-1 ring-border ${compact ? "px-3 py-2" : "px-3 py-2.5"}`} data-service={s.id}>
      <span aria-hidden="true" className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl ${s.id === "digitalocean" ? "bg-do text-do-foreground" : "bg-primary text-primary-foreground"}`}>
        <Icon className="size-4" strokeWidth={2.25} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-heading text-[0.95rem] leading-tight font-extrabold text-ink">{s.name}</span>
        <span className="text-xs leading-snug text-muted-foreground">{s.detail}</span>
      </span>
    </li>
  );
}

function Bullet({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm leading-snug">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sun" strokeWidth={2.25} />
      <span>{children}</span>
    </li>
  );
}

/** The printed pass, drawn small: the sprout-ticket stub, tick boxes and a tear line (decorative). */
function PaperArt() {
  return (
    <svg aria-hidden="true" viewBox="0 0 160 190" className="mx-auto w-full max-w-[11rem]" fill="none">
      <g transform="rotate(-3 80 95)">
        <rect x="14" y="8" width="132" height="174" rx="10" className="fill-sheet stroke-sheet-line" strokeWidth="1.5" />
        <rect x="26" y="20" width="56" height="12" rx="6" className="fill-mark" />
        {[48, 68, 88, 108].map((y, i) => (
          <g key={y}>
            <rect x="26" y={y} width="11" height="11" rx="2.5" className="stroke-sheet-ink" strokeWidth="1.8" />
            {i === 0 ? <path d={`M28.5 ${y + 5.5} l2.6 2.6 l5 -6`} className="stroke-mark" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /> : null}
            <rect x="44" y={y + 2} width={i % 2 ? 70 : 88} height="3.5" rx="1.75" className="fill-sheet-muted" opacity="0.55" />
            <rect x="44" y={y + 7.5} width={i % 2 ? 46 : 58} height="2.5" rx="1.25" className="fill-sheet-muted" opacity="0.3" />
          </g>
        ))}
        <path d="M14 136 H146" className="stroke-sheet-line" strokeWidth="1.5" strokeDasharray="3 4" />
        <rect x="26" y="148" width="48" height="3.5" rx="1.75" className="fill-sheet-muted" opacity="0.55" />
        <rect x="26" y="157" width="96" height="2.5" rx="1.25" className="fill-sheet-muted" opacity="0.3" />
        <rect x="26" y="164" width="80" height="2.5" rx="1.25" className="fill-sheet-muted" opacity="0.3" />
      </g>
    </svg>
  );
}

export function Blueprint({ hardRules, blockedGroups, modelId }: { hardRules: number; blockedGroups: number; modelId: string }) {
  const all = services();
  const data = all.filter((s) => s.group === "data");
  const model = all.find((s) => s.group === "model")!;
  const platform = all.filter((s) => s.group === "platform");
  return (
    <div data-testid="blueprint" className="gp-blueprint relative overflow-hidden rounded-[2rem] bg-background p-4 ring-1 ring-border sm:p-6 xl:p-8">
      <ol
        aria-label="How data flows into a pass, in 5 stages"
        className="relative grid gap-10 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.95fr)] xl:gap-x-10 xl:gap-y-0"
      >
        <Stage n={1} tone="data" title="Real park data">
          <ul aria-label="Data services" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {data.map((s) => (
              <ServiceChip key={s.id} s={s} compact />
            ))}
          </ul>
        </Stage>
        <Stage n={2} tone="code" title="Code builds the fact list" hotArrow>
          <ul className="flex flex-col gap-3">
            <Bullet icon={Database}>Each fact gets an id, source and date.</Bullet>
            <Bullet icon={ShieldCheck}>
              Removes <strong>{blockedGroups} risky species groups</strong> first.
            </Bullet>
            <Bullet icon={MapPinned}>Picks the spot, draws the map.</Bullet>
          </ul>
        </Stage>
        <Stage n={3} tone="model" title={model.name} hotArrow className="xl:-my-3" service={model.id}>
          <div className="flex flex-col gap-1">
            <p className="w-fit rounded-lg bg-sun-foreground px-2 py-0.5 font-mono text-sm text-sun">{modelId}</p>
            <p className="text-sm font-semibold">
              {model.terms.split(";")[0]} ·{" "}
              <a href="#digitalocean" className="underline decoration-sun-foreground/40 underline-offset-2 hover:decoration-sun-foreground">
                DigitalOcean serverless inference
              </a>
            </p>
          </div>
          <ul aria-label="The model's jobs" className="flex flex-col gap-2">
            {[
              ["#ai-job-1", "Picks finds, writes clues with proof quotes"],
              ["#ai-job-2", "Writes the Find This Spot riddle"],
              ["#ai-job-3", "Writes the trip tips"],
            ].map(([href, label], i) => (
              <li key={href}>
                <a href={href} className="flex items-start gap-2.5 rounded-xl bg-white/60 px-3 py-2 text-sm leading-snug font-semibold text-sun-foreground underline-offset-2 ring-1 ring-sun-foreground/15 hover:bg-white/80 hover:underline">
                  <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sun-foreground font-heading text-[0.7rem] font-extrabold text-sun">
                    {i + 1}
                  </span>
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <ul className="mt-auto flex flex-col gap-1.5 border-t border-sun-foreground/20 pt-3 text-sm font-semibold">
            <li className="flex items-center gap-2">
              <Braces aria-hidden="true" className="size-4 shrink-0" />
              Strict JSON: only the park&apos;s own ids
            </li>
            <li className="flex items-center gap-2">
              <PenLine aria-hidden="true" className="size-4 shrink-0" />
              1-{MAX_MODEL_CALLS} clue calls + 1 tips call a pass
            </li>
          </ul>
        </Stage>
        <Stage n={4} tone="code" title="Code checks every line">
          <ul className="flex flex-col gap-3">
            <Bullet icon={ListChecks}>
              <strong>{hardRules} hard rules</strong> (quotes, names, numbers, safety). Fail one: removed.
            </Bullet>
            <Bullet icon={PenLine}>Too few left? Asks again.</Bullet>
            <Bullet icon={ShieldCheck}>Writes dates, safety lines and answers.</Bullet>
          </ul>
        </Stage>
        <Stage n={5} tone="paper" title="Your printed pass" last>
          <PaperArt />
          <p className="text-sm leading-snug text-muted-foreground">
            <Printer aria-hidden="true" className="mr-1.5 inline size-4 align-[-3px] text-ink" />
            The kid&apos;s hunt on top; answers and sources below.
          </p>
        </Stage>
      </ol>

      <div className="relative mt-10 flex flex-col gap-3 border-t-2 border-dashed border-line pt-5 lg:flex-row lg:items-center lg:gap-6">
        <h3 className="shrink-0 text-xs font-bold tracking-widest text-ink uppercase">Runs on</h3>
        <ul aria-label="Platform services" className="grid flex-1 gap-2 sm:grid-cols-2 2xl:grid-cols-4">
          {platform.map((s) => (
            <ServiceChip key={s.id} s={s} />
          ))}
        </ul>
      </div>
    </div>
  );
}
