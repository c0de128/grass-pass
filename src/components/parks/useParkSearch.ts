"use client";

/**
 * F1 "Find a park" logic (the wizard, Kevin 2026-10-07): a place search (submit only, no autocomplete) or "Use my
 * location" (rounded to 2 decimals, ~1 km, in the browser before it is sent), then a list of real OpenStreetMap
 * parks nearest first. The hero card and the wizard's "Pick your park" step share one instance of this hook.
 * Field errors are returned with an `attempt` counter so the alert is re-mounted (re-announced) on every failure.
 */
import { useEffect, useRef, useState } from "react";
import { roundCoord } from "@/lib/geo";
import { LOCATION_DECIMALS, PlaceQueryLimits } from "@/lib/parks/constants";
import type { ExampleLink, ParksResult } from "@/lib/parks/schema";

/**
 * UX-4-02: the answer's schemas (and zod) load on demand, in parallel with the search request, so they are not
 * part of the home page's first JavaScript. A failed chunk load counts as being offline.
 */
const loadSchemas = () => import("@/lib/parks/schema");

export const PARK_SEARCH_COPY = {
  qEmpty: "Type a town, ZIP or park name.",
  qShort: "Type at least 2 letters or numbers: a town, ZIP or park name.",
  qLong: `That's too long. Type a town, ZIP or park name (up to ${PlaceQueryLimits.max} characters).`,
  noGeo: "Your browser can't share your location. Type a town or ZIP instead.",
  geoDenied: "Location is blocked for this site. Type a town or ZIP, or allow location in your browser settings.",
  geoFailed: "We couldn't get your location. Try again or type a town or ZIP.",
  offline: "We couldn't reach Grass Pass. Check your internet connection and try again.",
  badAnswer: "Something went wrong reading the park list. Please try again.",
  slow: "Still working. The OpenStreetMap park server can be slow. If it doesn't answer soon, we'll try a saved park list or the OpenStreetMap place search instead.",
  locating: "Asking your browser for your location…",
} as const;

/** Client-side wait for /api/parks: a bit over the route's maxDuration (90 s). */
const CLIENT_TIMEOUT_MS = 95_000;
const SLOW_AFTER_MS = 8_000;

export type ParkSearchPhase =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "searching"; label: string }
  | { kind: "done"; result: ParksResult }
  | { kind: "failed"; message: string; code: string; example?: ExampleLink };

/** The field's problem, or null when the text can be searched. */
export function checkQuery(raw: string): string | null {
  const q = raw.replace(/\s+/g, " ").trim();
  if (!q || !/[\p{L}\p{N}]/u.test(q)) return PARK_SEARCH_COPY.qEmpty;
  if (q.length < PlaceQueryLimits.min) return PARK_SEARCH_COPY.qShort;
  if (q.length > PlaceQueryLimits.max) return PARK_SEARCH_COPY.qLong;
  return null;
}

export function cleanQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function searchingLabel(q: string): string {
  return `Searching OpenStreetMap for “${q}” and parks within 5 km…`;
}

export const LOCATION_SEARCHING_LABEL = "Searching OpenStreetMap for parks within 5 km of you…";

export type FieldProblem = { message: string; attempt: number };

export function useParkSearch() {
  const [phase, setPhase] = useState<ParkSearchPhase>({ kind: "idle" });
  const [slow, setSlow] = useState(false);
  /** A problem with the typed place (shown on the wizard's search field). */
  const [fieldError, setFieldError] = useState<FieldProblem | null>(null);
  /** A problem with "Use my location". */
  const [locError, setLocError] = useState<FieldProblem | null>(null);
  const attemptRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (slowTimer.current) clearTimeout(slowTimer.current);
    },
    [],
  );

  const busy = phase.kind === "locating" || phase.kind === "searching";

  function stopSlowTimer() {
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = null;
    setSlow(false);
  }

  function fail(kind: "q" | "location", message: string) {
    attemptRef.current += 1;
    const p = { message, attempt: attemptRef.current };
    if (kind === "q") setFieldError(p);
    else setLocError(p);
  }

  /** POST, so what was typed (or the rounded location) never goes in a URL or a request log (SEC-1-03). */
  async function runSearch(body: { q: string } | { lat: string; lng: string }, label: string, from: "q" | "location") {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase({ kind: "searching", label });
    stopSlowTimer();
    slowTimer.current = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    const timeout = setTimeout(() => ac.abort(), CLIENT_TIMEOUT_MS);

    let res: Response;
    let json: unknown;
    let schemas: Awaited<ReturnType<typeof loadSchemas>>;
    try {
      [res, schemas] = await Promise.all([
        fetch("/api/parks", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ac.signal,
        }),
        loadSchemas(),
      ]);
      json = await res.json().catch(() => null);
    } catch {
      clearTimeout(timeout);
      if (abortRef.current !== ac) return; // a newer search replaced this one
      stopSlowTimer();
      setPhase({ kind: "failed", message: PARK_SEARCH_COPY.offline, code: ac.signal.aborted ? "CLIENT_TIMEOUT" : "OFFLINE" });
      return;
    }
    clearTimeout(timeout);
    if (abortRef.current !== ac) return;
    stopSlowTimer();

    if (!res.ok) {
      const err = schemas.ApiErrorSchema.safeParse(json);
      const message = err.success ? err.data.error.message : PARK_SEARCH_COPY.badAnswer;
      const field = err.success ? err.data.error.field : undefined;
      setPhase({ kind: "idle" });
      if (res.status === 400 && field === "q") return fail("q", message);
      if (res.status === 400 && field === "location") return fail("location", message);
      setPhase({
        kind: "failed",
        message,
        code: err.success ? err.data.error.code : "BAD_ANSWER",
        example: err.success ? err.data.error.example : undefined,
      });
      return;
    }
    const parsed = schemas.ParksResultSchema.safeParse(json);
    if (!parsed.success) {
      setPhase({ kind: "failed", message: PARK_SEARCH_COPY.badAnswer, code: "BAD_ANSWER" });
      return;
    }
    const result = parsed.data;
    if (result.empty?.reason === "no_place") {
      setPhase({ kind: "idle" });
      fail(from, result.empty.message);
      return;
    }
    setPhase({ kind: "done", result });
  }

  /** Search for typed text. Returns false (and sets the field error) when the text can't be searched. */
  function search(raw: string): boolean {
    if (busy) return false;
    setLocError(null);
    const problem = checkQuery(raw);
    if (problem) {
      fail("q", problem);
      return false;
    }
    setFieldError(null);
    const clean = cleanQuery(raw);
    void runSearch({ q: clean }, searchingLabel(clean), "q");
    return true;
  }

  function locate(): void {
    if (busy) return;
    setFieldError(null);
    setLocError(null);
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return fail("location", PARK_SEARCH_COPY.noGeo);
    setPhase({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Rounded here, before anything leaves the device (~1 km).
        const lat = roundCoord(pos.coords.latitude, LOCATION_DECIMALS);
        const lng = roundCoord(pos.coords.longitude, LOCATION_DECIMALS);
        void runSearch({ lat: lat.toFixed(LOCATION_DECIMALS), lng: lng.toFixed(LOCATION_DECIMALS) }, LOCATION_SEARCHING_LABEL, "location");
      },
      (err) => {
        setPhase({ kind: "idle" });
        fail("location", err.code === err.PERMISSION_DENIED ? PARK_SEARCH_COPY.geoDenied : PARK_SEARCH_COPY.geoFailed);
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
    );
  }

  const progress =
    phase.kind === "locating"
      ? PARK_SEARCH_COPY.locating
      : phase.kind === "searching"
        ? slow
          ? `${phase.label} ${PARK_SEARCH_COPY.slow}`
          : phase.label
        : "";

  return {
    phase,
    busy,
    progress,
    fieldError,
    locError,
    search,
    locate,
    clearFieldError: () => setFieldError(null),
    /** Shows a field problem found before searching (the hero checks the text itself). */
    showFieldError: (message: string) => fail("q", message),
  };
}

export type ParkSearch = ReturnType<typeof useParkSearch>;
