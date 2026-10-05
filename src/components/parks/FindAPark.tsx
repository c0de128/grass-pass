"use client";

/**
 * F1 "Find a park": a place search (submit only, no autocomplete) or "Use my location"
 * (rounded to 2 decimals, ~1 km, in the browser before it is sent), then a list of real
 * OpenStreetMap parks nearest first. Field errors follow the starter-kit pattern: focus the
 * field, aria-invalid, aria-describedby, role=alert, re-announced on every failed submit.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { Button, buttonClassName } from "@/components/ui/Button";
import { TicketCard } from "@/components/ui/TicketCard";
import { distanceLabel, roundCoord } from "@/lib/geo";
import {
  ApiErrorSchema,
  LOCATION_DECIMALS,
  ParksResultSchema,
  PlaceQueryLimits,
  type Park,
  type ParksResult,
} from "@/lib/parks/schema";

const COPY = {
  qEmpty: "Type a town, ZIP or park name.",
  qShort: "Type at least 2 letters or numbers: a town, ZIP or park name.",
  qLong: `That's too long. Type a town, ZIP or park name (up to ${PlaceQueryLimits.max} characters).`,
  noGeo: "Your browser can't share a location. Type a town or ZIP instead.",
  geoDenied: "Location is blocked for this site. Type a town or ZIP instead, or allow location in your browser settings.",
  geoFailed: "We couldn't get your location. Try again, or type a town or ZIP.",
  offline: "We couldn't reach Grass Pass. Check your internet connection and try again.",
  badAnswer: "Something went wrong reading the park list. Please try again.",
  slow: "Still working: the OpenStreetMap park server can be slow. If it doesn't answer within 30 seconds we try another server.",
} as const;

/** Client-side wait for /api/parks: a bit over the route's maxDuration (90 s). */
const CLIENT_TIMEOUT_MS = 95_000;
const SLOW_AFTER_MS = 8_000;

type Phase =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "searching"; label: string }
  | { kind: "done"; result: ParksResult }
  | { kind: "failed"; message: string };

export type FindAParkProps = {
  /** Called when a park is chosen (the pass step, S3). Without it the list says what happens next. */
  onPick?: (park: Park) => void;
};

function formatChecked(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

function kindLabel(kind: Park["kind"]): string {
  return kind === "nature_reserve" ? "Nature preserve" : "Park";
}

function checkQuery(raw: string): string | null {
  const q = raw.replace(/\s+/g, " ").trim();
  if (!q || !/[\p{L}\p{N}]/u.test(q)) return COPY.qEmpty;
  if (q.length < PlaceQueryLimits.min) return COPY.qShort;
  if (q.length > PlaceQueryLimits.max) return COPY.qLong;
  return null;
}

export function FindAPark({ onPick }: FindAParkProps) {
  const ids = useId();
  const inputId = `${ids}-place`;
  const hintId = `${ids}-place-hint`;
  const errorId = `${ids}-place-error`;
  const locErrorId = `${ids}-loc-error`;
  const locNoteId = `${ids}-loc-note`;

  const [q, setQ] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  /** Bumped on every failed attempt so the alert is re-mounted and re-announced. */
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [slow, setSlow] = useState(false);
  const [picked, setPicked] = useState<Park | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const locButtonRef = useRef<HTMLButtonElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusResults = useRef(false);

  const busy = phase.kind === "locating" || phase.kind === "searching";

  useEffect(() => {
    if (phase.kind === "done" && focusResults.current) {
      focusResults.current = false;
      resultsHeadingRef.current?.focus();
    }
  }, [phase]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (slowTimer.current) clearTimeout(slowTimer.current);
    },
    [],
  );

  function stopSlowTimer() {
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = null;
    setSlow(false);
  }

  function showFieldError(message: string) {
    setFieldError(message);
    setAttempt((a) => a + 1);
    inputRef.current?.focus();
  }

  function showLocError(message: string) {
    setLocError(message);
    setAttempt((a) => a + 1);
    locButtonRef.current?.focus();
  }

  async function runSearch(params: URLSearchParams, label: string, from: "q" | "location") {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPicked(null);
    setPhase({ kind: "searching", label });
    stopSlowTimer();
    slowTimer.current = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    const timeout = setTimeout(() => ac.abort(), CLIENT_TIMEOUT_MS);

    let res: Response;
    let json: unknown;
    try {
      res = await fetch(`/api/parks?${params.toString()}`, { headers: { Accept: "application/json" }, signal: ac.signal });
      json = await res.json().catch(() => null);
    } catch {
      clearTimeout(timeout);
      if (abortRef.current !== ac) return; // a newer search replaced this one
      stopSlowTimer();
      setPhase({ kind: "failed", message: COPY.offline });
      return;
    }
    clearTimeout(timeout);
    if (abortRef.current !== ac) return;
    stopSlowTimer();

    if (!res.ok) {
      const err = ApiErrorSchema.safeParse(json);
      const message = err.success ? err.data.error.message : COPY.badAnswer;
      const field = err.success ? err.data.error.field : undefined;
      setPhase({ kind: "idle" });
      if (res.status === 400 && field === "q") return showFieldError(message);
      if (res.status === 400 && field === "location") return showLocError(message);
      setPhase({ kind: "failed", message });
      return;
    }
    const parsed = ParksResultSchema.safeParse(json);
    if (!parsed.success) {
      setPhase({ kind: "failed", message: COPY.badAnswer });
      return;
    }
    const result = parsed.data;
    if (result.empty?.reason === "no_place") {
      setPhase({ kind: "idle" });
      if (from === "q") showFieldError(result.empty.message);
      else showLocError(result.empty.message);
      return;
    }
    focusResults.current = true;
    setPhase({ kind: "done", result });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setLocError(null);
    const problem = checkQuery(q);
    if (problem) return showFieldError(problem);
    setFieldError(null);
    const clean = q.replace(/\s+/g, " ").trim();
    void runSearch(new URLSearchParams({ q: clean }), `Searching OpenStreetMap for “${clean}” and parks within 5 km…`, "q");
  }

  function onUseLocation() {
    if (busy) return;
    setFieldError(null);
    setLocError(null);
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return showLocError(COPY.noGeo);
    setPhase({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Rounded here, before anything leaves the device (~1 km).
        const lat = roundCoord(pos.coords.latitude, LOCATION_DECIMALS);
        const lng = roundCoord(pos.coords.longitude, LOCATION_DECIMALS);
        void runSearch(
          new URLSearchParams({ lat: lat.toFixed(LOCATION_DECIMALS), lng: lng.toFixed(LOCATION_DECIMALS) }),
          "Searching OpenStreetMap for parks within 5 km of you…",
          "location",
        );
      },
      (err) => {
        setPhase({ kind: "idle" });
        showLocError(err.code === err.PERMISSION_DENIED ? COPY.geoDenied : COPY.geoFailed);
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
    );
  }

  function pick(park: Park) {
    setPicked(park);
    onPick?.(park);
  }

  const progress =
    phase.kind === "locating"
      ? "Asking your browser for your location…"
      : phase.kind === "searching"
        ? slow
          ? `${phase.label} ${COPY.slow}`
          : phase.label
        : "";

  return (
    <section aria-labelledby={`${ids}-heading`} className="flex flex-col gap-4">
      <h2 id={`${ids}-heading`} className="text-2xl">
        Where?
      </h2>

      <form aria-label="Find a park" noValidate onSubmit={onSubmit} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-lg font-semibold">
          Town, ZIP or park name
        </label>
        <p id={hintId} className="text-base text-muted">
          For example: Allen TX, 75013 or Connemara Meadow Preserve.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            ref={inputRef}
            id={inputId}
            name="q"
            type="text"
            inputMode="search"
            autoComplete="address-level2"
            spellCheck={false}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (fieldError) setFieldError(null);
            }}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? `${hintId} ${errorId}` : hintId}
            className="min-h-11 min-w-0 flex-1 rounded-control border-2 border-line bg-surface px-3 text-lg text-fg"
          />
          <Button type="submit" aria-disabled={busy || undefined}>
            {phase.kind === "searching" ? "Searching…" : "Find parks"}
          </Button>
        </div>
        {fieldError ? (
          <p key={`q-${attempt}`} id={errorId} role="alert" className="font-semibold">
            {fieldError}
          </p>
        ) : null}
      </form>

      <div className="flex flex-col gap-1">
        <p aria-hidden="true" className="text-base">
          or
        </p>
        <button
          ref={locButtonRef}
          type="button"
          onClick={onUseLocation}
          aria-disabled={busy || undefined}
          aria-describedby={locError ? `${locNoteId} ${locErrorId}` : locNoteId}
          className={buttonClassName("secondary", "self-start")}
        >
          Use my location
        </button>
        <p id={locNoteId} className="text-base text-muted">
          Your location is rounded to about 1 km on this device before it is sent.
        </p>
        {locError ? (
          <p key={`loc-${attempt}`} id={locErrorId} role="alert" className="font-semibold">
            {locError}
          </p>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="min-h-6 text-base">
        {progress}
      </p>

      {phase.kind === "failed" ? (
        <div role="alert" className="rounded-ticket border-2 border-line bg-surface p-4">
          <p className="font-semibold">{phase.message}</p>
        </div>
      ) : null}

      {phase.kind === "done" ? <ParkList result={phase.result} picked={picked} onPick={pick} hasNextStep={!!onPick} headingRef={resultsHeadingRef} /> : null}
    </section>
  );
}

function ParkList({
  result,
  picked,
  onPick,
  hasNextStep,
  headingRef,
}: {
  result: ParksResult;
  picked: Park | null;
  onPick: (p: Park) => void;
  hasNextStep: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const where = result.query.kind === "text" ? (result.query.matched ?? result.query.text) : "your location";
  const checked = formatChecked(result.checkedAt);
  return (
    <TicketCard as="section" aria-labelledby="park-results-heading">
      <div className="flex flex-col gap-3">
      <h2 id="park-results-heading" ref={headingRef} tabIndex={-1} className="text-xl">
        Parks near {where}
      </h2>
      {result.parks.length === 0 ? (
        <p className="rounded-ticket border-2 border-line bg-surface p-4 font-semibold">{result.empty?.message}</p>
      ) : (
        <>
          <p className="text-base">
            {result.parks.length < result.totalFound
              ? `The ${result.parks.length} nearest of ${result.totalFound} named parks within 5 km.`
              : `${result.parks.length} named ${result.parks.length === 1 ? "park" : "parks"} within 5 km.`}{" "}
            Pick one.
          </p>
          <ol className="flex flex-col gap-2" aria-label={`Parks near ${where}`}>
            {result.parks.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  aria-pressed={picked?.id === p.id}
                  className="flex min-h-11 w-full flex-col items-start rounded-control border-2 border-line bg-surface px-4 py-2 text-left text-fg hover:bg-secondary-hover aria-pressed:bg-primary aria-pressed:text-on-primary"
                >
                  <span className="font-display text-lg font-semibold">{p.name}</span>
                  <span className="text-base">
                    {kindLabel(p.kind)} · {distanceLabel(p.distanceM)} away
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
      {picked && !hasNextStep ? (
        <p role="status" className="rounded-ticket border-2 border-line bg-surface p-4">
          You picked <strong>{picked.name}</strong>. Making a pass for a park isn&apos;t switched on in this build yet.
        </p>
      ) : null}
      <p className="text-sm">
        Park list from{" "}
        <a className="underline" href="https://www.openstreetmap.org/copyright">
          © OpenStreetMap contributors
        </a>
        {result.query.kind === "text" ? " (place search by Nominatim)" : ""}
        {checked ? `, checked ${checked}` : ""}
        {result.cached ? " (saved copy; park maps change slowly)" : ""}.
      </p>
      </div>
    </TicketCard>
  );
}
