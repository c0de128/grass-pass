"use client";

/**
 * The main journey (SPEC §2 steps 2-5): pick a park (S2's FindAPark) with the Explorer age chosen in the
 * same search card (v3, Kevin's v0 design: 4-6, 6-10 default, 10-13; remembered in localStorage only) ->
 * "Make a pass for <park>" (the age is already chosen, so it isn't asked again) -> make the pass with the
 * server's real progress steps -> open the pass page. Failures show their exact copy; a model failure also
 * shows the real park data we found (never as a pass).
 *
 * Accounts (2026-10-06): a signed-out visitor sees "Sign in to make this pass" (GitHub / Google / Try as a
 * judge) instead of the make button, plus "Open a pass someone already made today" for a pass made today (free,
 * no sign-in). The park + age are kept in sessionStorage across the sign-in round trip and restored on
 * `/?resume=1`.
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { SignInCard } from "@/components/account/SignInCard";
import { FindAPark } from "@/components/parks/FindAPark";
import type { SignInOptions } from "@/lib/accounts/config";
import { Button, buttonClassName } from "@/components/ui/Button";
import type { Park } from "@/lib/parks/schema";
import { safeParkName } from "@/lib/safety/contact";
import { AGE_BAND_INFO, AGE_BAND_STORAGE_KEY, AGE_BANDS, DEFAULT_AGE_BAND, isAgeBand, type AgeBand } from "@/lib/pass/constants";
import { ParkDataList, ProgressSteps, SectionNotes } from "./PassStatus";
import { clientNow, LOCAL_WAIT_COPY, PASS_WAIT_COPY, retryFailsNow, usePassRequest, type PassState } from "./usePassRequest";

/** Failures where an immediate retry can't help (a limit that resets later): no "Try again" button. */
const NO_RETRY = new Set(["VARIANT_LIMIT", "IP_DAILY_LIMIT", "DAILY_LIMIT", "ACCOUNT_DAILY_LIMIT", "JUDGE_DAILY_LIMIT", "SIGN_IN_REQUIRED"]);

/** sessionStorage key: the park + age picked before signing in (this tab only, removed once restored). */
export const RESUME_KEY = "grass-pass:resume";

function rememberForSignIn(park: Park, band: AgeBand): void {
  try {
    window.sessionStorage.setItem(RESUME_KEY, JSON.stringify({ park, band }));
  } catch {
    // storage off: after signing in the visitor picks the park again
  }
}

/**
 * The park + age saved before sign-in, once (validated with the real schemas, loaded on demand so zod is not in
 * the first JavaScript, UX-4-02; anything else is ignored).
 */
export async function takeResume(): Promise<{ park: Park; band: AgeBand } | null> {
  try {
    const raw = window.sessionStorage.getItem(RESUME_KEY);
    window.sessionStorage.removeItem(RESUME_KEY);
    if (!raw) return null;
    const [{ ParkSchema }, { AgeBandSchema }] = await Promise.all([import("@/lib/parks/schema"), import("@/lib/pass/schema")]);
    const json: unknown = JSON.parse(raw);
    const r = ParkSchema.safeParse((json as { park?: unknown } | null)?.park);
    const b = AgeBandSchema.safeParse((json as { band?: unknown } | null)?.band);
    return r.success && b.success ? { park: r.data, band: b.data } : null;
  } catch {
    return null;
  }
}

/** Who is making the pass (from the server page): signed in or not, and which sign-in buttons exist. */
/** `judge`: signed in with "Try as a judge" (for the "Signed in as a judge" announcement, UX-4-03). */
export type PassMakerAccount = { signedIn: boolean; judge?: boolean; options: SignInOptions };

/** Said (polite live region) and shown after coming back from signing in, as focus moves to "Make my pass". */
export function signedInNote(judge: boolean): string {
  return judge ? "Signed in as a judge. You can make this pass now." : "Signed in. You can make the pass now.";
}

/** Real seconds since the request started, ticking once a second while it runs. */
function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(() => clientNow());
  useEffect(() => {
    if (startedAt === null) return;
    const t = setInterval(() => setNow(clientNow()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
}

/** Whole seconds left until `at` (client clock), ticking once a second; null when there is no `at`. */
function useSecondsUntil(at: number | undefined): number | null {
  const [now, setNow] = useState(() => clientNow());
  useEffect(() => {
    if (at === undefined) return;
    const t = setInterval(() => setNow(clientNow()), 1000);
    return () => clearInterval(t);
  }, [at]);
  return at === undefined ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * A failed pass: the exact message, the one automatic retry's countdown (map data busy or slow,
 * R2-M3), "Try again", a ready example pass when the server offered one, and any real park data.
 */
export function PassFailure({
  state,
  secondsToRetry,
  onTryAgain,
}: {
  state: Extract<PassState, { kind: "failed" }>;
  secondsToRetry: number | null;
  onTryAgain: () => void;
}) {
  return (
    <>
      <div role="alert" data-error-code={state.code} className="rounded-2xl bg-muted p-4">
        <p className="font-semibold">{state.message}</p>
      </div>
      {secondsToRetry !== null ? (
        // Not a live region: a ticking number would be read out every second.
        <p className="text-base" data-testid="pass-auto-retry">
          Trying once more by itself in {secondsToRetry} s.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {NO_RETRY.has(state.code) || retryFailsNow(state.code, state.retryAfter) ? null : (
          <Button type="button" variant="secondary" onClick={onTryAgain}>
            {secondsToRetry !== null ? "Try again now" : "Try again"}
          </Button>
        )}
        {state.example ? (
          <Link href={state.example.href} prefetch={false} className={buttonClassName("secondary")}>
            See a ready example pass: {state.example.name}
          </Link>
        ) : null}
      </div>
      {state.parkData ? <ParkDataList data={state.parkData} /> : null}
    </>
  );
}

export function readStoredBand(): AgeBand {
  try {
    const v = window.localStorage.getItem(AGE_BAND_STORAGE_KEY);
    return isAgeBand(v) ? v : DEFAULT_AGE_BAND;
  } catch {
    return DEFAULT_AGE_BAND;
  }
}

function storeBand(b: AgeBand) {
  try {
    window.localStorage.setItem(AGE_BAND_STORAGE_KEY, b);
  } catch {
    // Private mode / storage off: the default works fine.
  }
}

/** The remembered band as an external store: the server (and the first paint) use the default. */
const noSubscribe = () => () => {};
const serverBand = (): AgeBand => DEFAULT_AGE_BAND;

/** Short, fun hints in Kevin's home-copy voice, kept true to AGE_BAND_INFO (6 or 8 finds; 10-13 has 2 hard ones). */
export const AGE_HINTS: Record<AgeBand, string> = {
  "4-6": "6 finds, you read aloud",
  "6-10": "8 finds, the sweet spot",
  "10-13": "8 finds, 2 brain-benders",
};

/**
 * "Explorer age" (v3 search card): three big radio tiles, the chosen one sunflower yellow with an ink border.
 * Real radios (visually hidden) inside labels, so arrow keys and screen readers work as usual.
 */
export function AgePicker({ band, onChange, legendId }: { band: AgeBand; onChange: (b: AgeBand) => void; legendId: string }) {
  return (
    <fieldset className="flex flex-col" aria-describedby={`${legendId}-note`}>
      <legend id={legendId} className="mb-2.5 text-xs font-bold tracking-widest text-muted-foreground uppercase">
        Explorer age
      </legend>
      <div className="grid grid-cols-3 gap-2">
        {AGE_BANDS.map((b) => (
          <label
            key={b}
            className={`flex min-h-12 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-2xl border-2 px-2 py-2.5 text-center transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid ${
              band === b ? "border-ink bg-sun text-sun-foreground" : "border-transparent bg-muted text-foreground hover:border-line"
            }`}
          >
            <input type="radio" name="ageBand" value={b} checked={band === b} onChange={() => onChange(b)} className="sr-only" />
            <span className="font-heading text-lg leading-none font-extrabold">
              <span className="sr-only">Ages </span>
              {b.replace("-", "–")}
              {b === DEFAULT_AGE_BAND ? <span className="sr-only"> (most kids)</span> : null}
            </span>
            <span className="hidden text-[11px] leading-tight sm:block">{AGE_HINTS[b]}</span>
          </label>
        ))}
      </div>
      <p id={`${legendId}-note`} className="sr-only">
        Only the park and this age range are sent to make the pass. We remember your choice on this device only.
      </p>
    </fieldset>
  );
}

export function PassMaker({ account }: { account?: PassMakerAccount } = {}) {
  const ids = useId();
  const [park, setPark] = useState<Park | null>(null);
  // The remembered band (localStorage) until the visitor picks one here.
  const storedBand = useSyncExternalStore(noSubscribe, readStoredBand, serverBand);
  const [pickedBand, setPickedBand] = useState<AgeBand | null>(null);
  const band = pickedBand ?? storedBand;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const makeRef = useRef<HTMLButtonElement>(null);
  // UX-4-03: back from signing in -> announce it and move focus to "Make my pass" (not the heading).
  const [resumed, setResumed] = useState(false);
  const resumedRef = useRef(false);
  const [note, setNote] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { state, run, reset } = usePassRequest();
  const working = state.kind === "working";
  const elapsed = useElapsedSeconds(state.kind === "working" ? state.startedAt : null);
  const secondsToRetry = useSecondsUntil(state.kind === "failed" ? state.autoRetryAt : undefined);
  const lastRequest = useRef<{ parkId: string; ageBand: AgeBand } | null>(null);
  // Signed out (or the session ended): show the sign-in card instead of the make button.
  const needsSignIn = account !== undefined && (!account.signedIn || (state.kind === "failed" && state.code === "SIGN_IN_REQUIRED" && account.signedIn));

  // Back from signing in (/?resume=1): restore the park + age picked before, then clean the address. The judge
  // sign-in comes back with a client navigation (this component stays mounted), OAuth with a full page load.
  const resume = useSearchParams().get("resume");
  useEffect(() => {
    if (resume === null) return;
    window.history.replaceState(null, "", "/#find");
    // Not cancelled on cleanup: replaceState below clears ?resume, which re-runs this effect while the judge
    // sign-in keeps this component mounted (state updates after an unmount are a no-op).
    void takeResume().then((r) => {
      if (!r) return;
      setPark(r.park);
      setPickedBand(r.band);
      storeBand(r.band);
      resumedRef.current = true;
      setResumed(true);
    });
  }, [resume]);

  // After a park is picked, bring the "make a pass" step into view and move focus to its heading (R1 UX m2):
  // with 10 parks listed it starts ~700 px further down on a phone.
  useEffect(() => {
    if (!park || resumedRef.current) return;
    const h = headingRef.current;
    if (!h) return;
    h.focus({ preventScroll: true });
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    h.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [park]);

  // Back from signing in with the park restored. The refreshed session can reach this component a moment after
  // the park is restored, so wait for it: until then the heading has focus; as soon as the session shows signed
  // in, say so (polite status) and move focus to "Make my pass" (UX-4-03). A cancelled sign-in just keeps the heading.
  const signedInNow = account?.signedIn === true && !needsSignIn;
  const judgeNow = account?.judge === true;
  const headingFocused = useRef(false);
  useEffect(() => {
    if (!resumed || !park) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!signedInNow) {
      if (headingFocused.current) return;
      headingFocused.current = true;
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hand-off after the sign-in round trip */
    resumedRef.current = false;
    headingFocused.current = false;
    setResumed(false);
    setNote(signedInNote(judgeNow));
    /* eslint-enable react-hooks/set-state-in-effect */
    makeRef.current?.focus({ preventScroll: true });
    makeRef.current?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [resumed, park, signedInNow, judgeNow]);

  useEffect(() => {
    if (state.kind === "done") {
      router.push(`/pass/${state.pass.id}${state.cached ? "?reused=1" : ""}`);
    } else if (state.kind === "failed" || state.kind === "empty") {
      resultRef.current?.focus();
    }
  }, [state, router]);

  function onPick(p: Park) {
    reset();
    setNote(null);
    resumedRef.current = false;
    setResumed(false);
    setPark(p);
  }

  function onBand(b: AgeBand) {
    setPickedBand(b);
    storeBand(b);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!park || working) return;
    storeBand(band);
    lastRequest.current = { parkId: park.id, ageBand: band };
    void run({ parkId: park.id, ageBand: band }, { autoRetry: true });
  }

  function tryAgain() {
    if (working || !lastRequest.current) return;
    void run(lastRequest.current);
  }

  function changeAge() {
    const radio = document.querySelector<HTMLInputElement>(`input[name="ageBand"][value="${band}"]`);
    radio?.focus();
  }

  return (
    <div className="flex flex-col gap-5">
      <FindAPark onPick={onPick} ageSlot={<AgePicker band={band} onChange={onBand} legendId={`${ids}-age-legend`} />} />

      {park ? (
        <section
          aria-labelledby={`${ids}-make`}
          className="scroll-mt-28 rounded-3xl bg-card p-5 text-card-foreground shadow-xl shadow-shadow ring-1 ring-border sm:p-6"
        >
          <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="Make a pass">
            <h2 id={`${ids}-make`} ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold tracking-tight text-ink">
              Make a pass for {safeParkName(park.name).name}
            </h2>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base" data-testid="chosen-age">
              <span>
                For <strong>{AGE_BAND_INFO[band].label}</strong>: {AGE_BAND_INFO[band].hint}.
              </span>
              <button type="button" onClick={changeAge} className="inline-flex min-h-11 items-center rounded-md font-semibold text-link underline underline-offset-4">
                Change age
              </button>
            </p>
            <p className="text-sm text-muted-foreground">
              Only the park and this age range are sent to make the pass. We remember your choice on this device only.
            </p>
            {/* Always in the page while a park is open, so the sign-in note is announced when it appears (UX-4-03). */}
            <p role="status" className={note ? "rounded-2xl bg-muted px-3 py-2 text-base font-semibold" : "sr-only"} data-testid="signed-in-note">
              {note}
            </p>
            {needsSignIn ? (
              <Button type="submit" variant="secondary" className="self-start" aria-disabled={working || undefined}>
                {working ? "Looking for today's pass…" : "Open a pass someone already made today"}
              </Button>
            ) : (
              <button ref={makeRef} type="submit" className={buttonClassName("primary", "self-start")} aria-disabled={working || undefined}>
                {working ? "Making your pass…" : "Make my pass"}
              </button>
            )}
          </form>

          {needsSignIn && account ? (
            <div className="mt-4">
              <SignInCard
                id={`${ids}-signin`}
                options={account.options}
                returnTo="/?resume=1"
                heading={state.kind === "failed" && state.code === "SIGN_IN_REQUIRED" && account.signedIn ? "Please sign in again to make this pass" : "Sign in to make this pass"}
                onBeforeSignIn={() => rememberForSignIn(park, band)}
              />
            </div>
          ) : null}

          {state.kind === "working" ? (
            <div className="mt-4 flex flex-col gap-2">
              <ProgressSteps steps={state.steps} />
              {/* Not a live region: a ticking number would be read out every second. */}
              <p className="text-base" data-testid="pass-elapsed">
                {elapsed} s so far. {state.local ? LOCAL_WAIT_COPY : PASS_WAIT_COPY}
              </p>
            </div>
          ) : null}

          {state.kind === "done" ? (
            <p role="status" className="mt-4">
              Your pass is ready. Opening it…
            </p>
          ) : null}

          {state.kind === "failed" ? (
            <div ref={resultRef} tabIndex={-1} className="mt-4 flex flex-col gap-3">
              <PassFailure
                state={
                  state.code === "SIGN_IN_REQUIRED" && account && !account.signedIn
                    ? { ...state, message: "No pass for this park and age was made today yet. Sign in above to make one." }
                    : state
                }
                secondsToRetry={secondsToRetry}
                onTryAgain={tryAgain}
              />
            </div>
          ) : null}

          {state.kind === "empty" ? (
            <div ref={resultRef} tabIndex={-1} className="mt-4 flex flex-col gap-3">
              <div role="alert" className="rounded-2xl bg-muted p-4">
                <p className="font-semibold">{state.message}</p>
              </div>
              <SectionNotes sections={state.sections} />
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
