"use client";

/**
 * The wizard's step 1 "Pick your park": a compact "search somewhere else" row with the distance choice (search v2:
 * 1, 3, 5 or 10 mi), the honest search status (with a paper-map "radar" while OpenStreetMap answers: decoration only,
 * never made-up parks), then the real parks: a street map with numbered pins (loaded only now) and the same parks as
 * big numbered cards. Errors keep their exact copy (field errors on the field, outside failures as an alert carrying
 * the server's code).
 */
import { ChevronRight, LoaderCircle, LocateFixed, MapPin, Search } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { buttonClassName } from "@/components/ui/Button";
import { distanceLabel } from "@/lib/geo";
import { parkMetaLine } from "@/lib/parks/kind-label";
import { resultsSummary } from "@/lib/parks/results-view";
import type { Park, ParksResult } from "@/lib/parks/schema";
import { safeParkName } from "@/lib/safety/contact";
import { RadiusChoice } from "./RadiusChoice";
import { SearchRadar } from "./SearchRadar";
import type { ParkSearch } from "./useParkSearch";

/** The street map and its library load only when a result list is on screen (client only, its own chunk). */
const ParkResultsMap = dynamic(() => import("./ParkResultsMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center rounded-2xl bg-[#edf4e2] text-sm font-semibold text-[#10291a] ring-1 ring-border sm:h-80" data-testid="park-map-loading">
      Loading the street map…
    </div>
  ),
});

function formatChecked(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

export function ParkStep({
  search,
  query,
  onQuery,
  picked,
  onPick,
}: {
  search: ParkSearch;
  query: string;
  onQuery: (q: string) => void;
  picked: Park | null;
  onPick: (p: Park) => void;
}) {
  const ids = useId();
  const inputId = `${ids}-q`;
  const errorId = `${ids}-q-error`;
  const locErrorId = `${ids}-loc-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const locRef = useRef<HTMLButtonElement>(null);
  const { phase, busy, fieldError, locError, progress, radiusMi } = search;

  // A field problem (or "no such place") moves focus to the field; a location problem to its button.
  const fieldAttempt = fieldError?.attempt;
  const locAttempt = locError?.attempt;
  useEffect(() => {
    if (fieldAttempt !== undefined) inputRef.current?.focus();
  }, [fieldAttempt]);
  useEffect(() => {
    if (locAttempt !== undefined) locRef.current?.focus();
  }, [locAttempt]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    search.search(query);
  }

  return (
    <div className="flex flex-col gap-5">
      <form aria-label="Search for a park" noValidate onSubmit={onSubmit} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-bold text-foreground">
          Search somewhere else
        </label>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <MapPin className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-primary" aria-hidden="true" />
            <input
              ref={inputRef}
              id={inputId}
              name="q"
              type="text"
              inputMode="search"
              autoComplete="address-level2"
              spellCheck={false}
              placeholder="Your town, ZIP or park name"
              value={query}
              onChange={(e) => {
                onQuery(e.target.value);
                if (fieldError) search.clearFieldError();
              }}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? errorId : undefined}
              className="h-12 w-full rounded-2xl border border-line bg-background/60 pr-3 pl-11 text-base text-foreground placeholder:text-muted-foreground aria-invalid:border-2 aria-invalid:border-destructive"
            />
          </div>
          <button type="submit" aria-disabled={busy || undefined} className={buttonClassName("secondary", "h-12 shrink-0 px-4")}>
            {phase.kind === "searching" ? (
              <LoaderCircle className="size-5 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <Search className="size-5" aria-hidden="true" />
            )}
            <span className="max-[400px]:sr-only">Search</span>
          </button>
        </div>
        {fieldError ? (
          <p key={`q-${fieldError.attempt}`} id={errorId} role="alert" className="text-sm font-semibold text-destructive">
            {fieldError.message}
          </p>
        ) : null}
        <div className="pt-2">
          <RadiusChoice value={radiusMi} onChange={search.chooseRadius} busy={busy} rerun={phase.kind === "done" || phase.kind === "failed"} />
        </div>
        <button
          ref={locRef}
          type="button"
          onClick={search.locate}
          aria-disabled={busy || undefined}
          aria-describedby={locError ? locErrorId : undefined}
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md text-sm font-semibold text-link underline-offset-4 hover:underline aria-disabled:opacity-60"
        >
          {phase.kind === "locating" ? (
            <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <LocateFixed className="size-4" aria-hidden="true" />
          )}
          Use my location
        </button>
        {locError ? (
          <p key={`loc-${locError.attempt}`} id={locErrorId} role="alert" className="text-sm font-semibold text-destructive">
            {locError.message}
          </p>
        ) : null}
      </form>

      {busy ? (
        <SearchRadar key={phase.kind === "searching" ? `run-${search.runId}` : "locating"} radiusMi={radiusMi} showSeconds={phase.kind === "searching"} />
      ) : null}

      <p role="status" aria-live="polite" className="-mt-2 text-base font-semibold empty:hidden" data-testid="park-search-status">
        {progress}
      </p>

      {phase.kind === "failed" ? (
        <div role="alert" data-error-code={phase.code} className="flex flex-col gap-3 rounded-2xl bg-muted p-4">
          <p className="font-semibold">{phase.message}</p>
          {phase.example ? (
            <Link href={phase.example.href} prefetch={false} className={buttonClassName("secondary", "self-start")}>
              See a ready example pass: {phase.example.name}
            </Link>
          ) : null}
        </div>
      ) : null}

      {phase.kind === "done" ? <ParkCards result={phase.result} picked={picked} onPick={onPick} /> : null}

      {phase.kind === "idle" && !fieldError && !locError ? (
        <p className="rounded-2xl bg-muted p-4 text-base">Type a town, ZIP or park name above, or use your location.</p>
      ) : null}
    </div>
  );
}

function ParkCards({ result, picked, onPick }: { result: ParksResult; picked: Park | null; onPick: (p: Park) => void }) {
  const where = result.query.kind === "text" ? (result.query.matched ?? result.query.text) : "your location";
  const checked = formatChecked(result.checkedAt);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** The park whose card (or pin) is hovered or focused: its pin and card light up together. */
  const [activeId, setActiveId] = useState<string | null>(null);
  const center = result.center;
  const mapParks = result.parks.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, distanceM: p.distanceM, label: safeParkName(p.name).name }));
  // A new list: move focus to its heading (as the page did before the wizard), so it is read out.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ block: "nearest" });
  }, [result]);
  return (
    <section aria-labelledby="park-results-heading" className="flex flex-col gap-3">
      <h3 id="park-results-heading" ref={headingRef} tabIndex={-1} className="scroll-mt-4 font-heading text-lg leading-snug font-extrabold text-ink">
        Parks near {where}
      </h3>
      {result.fallback ? (
        <p data-testid="parks-fallback" className="rounded-2xl bg-muted p-3 text-base">
          {result.fallback.message}
        </p>
      ) : null}
      {result.parks.length === 0 ? (
        <p className="rounded-2xl bg-muted p-4 font-semibold">{result.empty?.message}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="parks-summary">
            {resultsSummary(result.parks.length, result.totalFound, result.radiusMi, result.fallback?.kind === "nominatim")} Pick one.
          </p>
          {center ? (
            <ParkResultsMap
              key={`${result.checkedAt}|${result.radiusMi}|${center.lat},${center.lng}|${result.parks.map((p) => p.id).join(",")}`}
              center={center}
              radiusM={result.radiusM}
              parks={mapParks}
              activeId={activeId}
              onActive={setActiveId}
              onPick={(id) => {
                const p = result.parks.find((x) => x.id === id);
                if (p) onPick(p);
              }}
            />
          ) : null}
          <ol className="flex flex-col gap-2.5" aria-label={`Parks near ${where}`}>
            {result.parks.map((p, i) => {
              const name = safeParkName(p.name).name;
              const active = activeId === p.id;
              return (
                <li key={p.id} className="gp-wiz-rise" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                  <button
                    type="button"
                    onClick={() => onPick(p)}
                    onMouseEnter={() => setActiveId(p.id)}
                    onMouseLeave={() => setActiveId(null)}
                    onFocus={() => setActiveId(p.id)}
                    onBlur={() => setActiveId(null)}
                    aria-pressed={picked?.id === p.id}
                    data-active={active || undefined}
                    className="group flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border-2 border-transparent bg-muted px-4 py-3 text-left text-foreground transition-[border-color,transform,box-shadow] hover:border-line data-active:border-line motion-safe:hover:-translate-y-0.5 hover:shadow-md hover:shadow-shadow aria-pressed:border-ink aria-pressed:bg-sun aria-pressed:text-sun-foreground"
                  >
                    <span
                      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-base font-extrabold text-primary-foreground ring-2 ring-card group-data-active:bg-sun group-data-active:text-sun-foreground group-aria-pressed:bg-ink group-aria-pressed:text-on-ink"
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-heading text-lg leading-tight font-extrabold">{name}</span>
                      <span className="text-sm">{parkMetaLine(name, p.kind, distanceLabel(p.distanceM))}</span>
                    </span>
                    <ChevronRight className="size-5 shrink-0 opacity-70 transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Park list from{" "}
        <a className="underline" href="https://www.openstreetmap.org/copyright">
          © OpenStreetMap contributors
        </a>
        {result.query.kind === "text" || result.fallback?.kind === "nominatim" ? " (place search by Nominatim)" : ""}
        {checked ? `, checked ${checked}` : ""}
        {result.cached ? " (saved copy; park maps change slowly)" : ""}.
      </p>
    </section>
  );
}
