"use client";

/**
 * The main journey (SPEC §2 steps 2-5) as a guided wizard (Kevin 2026-10-07: "When the user clicks Find parks I want
 * a modal window to pop up and guide the user through the options. I also want a fun animation when the pass is
 * being created.").
 *
 * The hero card is just the search: "Your town, ZIP or park name" + Find parks + Use my location. A valid search (or
 * Use my location) opens a native <dialog> (showModal: the page behind is inert, focus stays inside, Esc and the
 * close button close it, focus goes back to what opened it, the page does not scroll behind it):
 *   1 Park: the real OpenStreetMap parks (skeleton while searching, the honest empty/error copy), search again inside.
 *   2 Explorer: "Who's exploring?", one card per age band (remembered in localStorage only).
 *   3 Make it: the choices on a little ticket, then "Make my pass" - or, signed out, the sign-in card (GitHub /
 *     Google / Try as a judge) and "Open a pass someone already made today". While the pass is made: the making
 *     picture and the server's REAL progress steps (PassMaking.tsx); then "Your pass is ready!" and the pass opens.
 * Every failure keeps its exact copy (daily limits, resting, model down, map busy) inside the dialog.
 *
 * Accounts: the park + age are kept in sessionStorage across the sign-in round trip and restored on `/?resume=1`,
 * which reopens the wizard on step 3 (focus on "Make my pass" once the session shows signed in).
 */
import { ArrowLeft, LoaderCircle, LocateFixed, MapPin, Sparkles, Target, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SignInCard } from "@/components/account/SignInCard";
import { ParkStep } from "@/components/parks/ParkStep";
import { checkQuery, useParkSearch } from "@/components/parks/useParkSearch";
import type { SignInOptions } from "@/lib/accounts/config";
import { Button, buttonClassName } from "@/components/ui/Button";
import type { Park } from "@/lib/parks/schema";
import { otherParksNear } from "@/lib/parks/nearby";
import { distanceLabel } from "@/lib/geo";
import { safeParkName } from "@/lib/safety/contact";
import { AGE_BAND_INFO, AGE_BAND_STORAGE_KEY, DEFAULT_AGE_BAND, isAgeBand, type AgeBand } from "@/lib/pass/constants";
import { FOCUS_PASS_KEY } from "./FocusPassHeading";
import { MAKING_PLAN, MakingChecklist, MakingScene, sceneStage } from "./PassMaking";
import { ParkDataList, SectionNotes } from "./PassStatus";
import { clientNow, LOCAL_WAIT_COPY, PASS_WAIT_COPY, retryFailsNow, usePassRequest, type PassState } from "./usePassRequest";
import { AgeChoices, StepTrail, stepAnnouncement, WIZARD_STEPS, stepIndex, type WizardStep } from "./WizardParts";

/** Failures where an immediate retry can't help (a limit that resets later): no "Try again" button. */
const NO_RETRY = new Set(["VARIANT_LIMIT", "IP_DAILY_LIMIT", "DAILY_LIMIT", "ACCOUNT_DAILY_LIMIT", "JUDGE_DAILY_LIMIT", "SIGN_IN_REQUIRED"]);

/** sessionStorage key: the park + age picked before signing in (this tab only, removed once restored). */
export const RESUME_KEY = "grass-pass:resume";

/**
 * How long "Your pass is ready!" shows before the pass opens by itself (the button opens it at once). UX-8-07: any key
 * or tap inside the wizard in that moment (or "Stay here") stops the auto-open, so nobody is moved on mid-read.
 */
export const READY_PAUSE_MS = 1_600;


/** UX-8-02: said in the wizard's live region when the pass is ready (it used to keep saying "Step 3 of 3"). */
export function readyAnnouncement(parkName: string, cached: boolean, autoOpen: boolean): string {
  const what = cached ? `Someone already made this pass for ${parkName} today.` : `Your pass for ${parkName} is ready.`;
  return autoOpen ? `${what} Opening it now. Press Stay here to stop.` : `${what} Open it when you like.`;
}

/**
 * Round 9 (Q-9-04): the earlier pass finished while the visitor is on the park step (shown, and said in the live region).
 * Picking a park still starts a new pass; the finished one stays saved.
 */
export function parkStepReadyText(parkName: string, cached: boolean): string {
  const what = cached ? `Someone already made this pass for ${parkName} today, and it is ready.` : `Your pass for ${parkName} is ready.`;
  return `${what} Open it with the link below, or pick a park to make a new one.`;
}

/** The park + age of the request that is really running (labels follow it, not the newest choice: Q-8-03). */
export type RunningRequest = { parkId: string; parkName: string; band: AgeBand };

/** Q-8-03: only a finished pass for the CURRENT choice may open by itself. */
export function matchesChoice(run: RunningRequest | null, park: Pick<Park, "id"> | null, band: AgeBand): boolean {
  return run !== null && park !== null && run.parkId === park.id && run.band === band;
}

function markPassFocus(): void {
  try {
    window.sessionStorage.setItem(FOCUS_PASS_KEY, "1");
  } catch {
    // storage off: the pass page just keeps the default focus
  }
}

export function rememberForSignIn(park: Park, band: AgeBand): void {
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

/** The wizard's heading for each moment of step 3. */
export function makeTitle(state: PassState): string {
  if (state.kind === "working") return "Making your pass…";
  if (state.kind === "done") return "Your pass is ready!";
  return WIZARD_STEPS[2].title;
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

const ageLabel = (b: AgeBand) => AGE_BAND_INFO[b].label.replace(/(\d)-(\d)/, "$1–$2");

export function PassMaker({ account, notice }: { account?: PassMakerAccount; notice?: ReactNode } = {}) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const heroInputId = `${ids}-place`;
  const heroHintId = `${ids}-place-hint`;
  const heroErrorId = `${ids}-place-error`;

  const search = useParkSearch();
  const [query, setQuery] = useState("");
  const [heroError, setHeroError] = useState<{ message: string; attempt: number } | null>(null);
  const [park, setPark] = useState<Park | null>(null);
  const storedBand = useSyncExternalStore(noSubscribe, readStoredBand, serverBand);
  const [pickedBand, setPickedBand] = useState<AgeBand | null>(null);
  const band = pickedBand ?? storedBand;

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>("park");
  const [announce, setAnnounce] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const makeRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const heroInputRef = useRef<HTMLInputElement>(null);
  const readyLinkRef = useRef<HTMLAnchorElement>(null);
  // Q-8-03: the request actually running (or last finished), so its labels never show a newer choice.
  const [running, setRunning] = useState<RunningRequest | null>(null);
  // UX-8-07: the visitor stopped the ready step's auto-open.
  const [stayed, setStayed] = useState(false);

  const router = useRouter();
  const { state, run, reset } = usePassRequest();
  const working = state.kind === "working";
  const secondsToRetry = useSecondsUntil(state.kind === "failed" ? state.autoRetryAt : undefined);
  // Signed out (or the session ended): show the sign-in card instead of the make button.
  const needsSignIn = account !== undefined && (!account.signedIn || (state.kind === "failed" && state.code === "SIGN_IN_REQUIRED" && account.signedIn));
  const signedInNow = account?.signedIn === true && !needsSignIn;
  const judgeNow = account?.judge === true;

  const title = step === "make" ? makeTitle(state) : WIZARD_STEPS[stepIndex(step)].title;

  // Open / close the native dialog to match `open`.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      headingRef.current?.focus({ preventScroll: true });
    } else if (!open && d.open) d.close();
  }, [open]);

  // A new step: back to the top, focus on its heading, and say which step it is (politely).
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    bodyRef.current?.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  function goTo(next: WizardStep) {
    setStep(next);
    setAnnounce(stepAnnouncement(next));
  }

  function openWizard(at: WizardStep, opener: HTMLElement | null) {
    openerRef.current = opener;
    setStep(at);
    setAnnounce(stepAnnouncement(at));
    setOpen(true);
  }

  /** The dialog closed (close button, Esc, or code): focus goes back to what opened it. */
  function onClosed() {
    setOpen(false);
    const back = openerRef.current?.isConnected ? openerRef.current : heroInputRef.current;
    back?.focus();
  }

  // Back from signing in (/?resume=1): restore the park + age picked before, reopen the wizard on step 3, then clean
  // the address. The judge sign-in comes back with a client navigation (this component stays mounted), OAuth with a
  // full page load.
  const resume = useSearchParams().get("resume");
  useEffect(() => {
    if (resume === null) return;
    window.history.replaceState(null, "", "/#find");
    // Not cancelled on cleanup: replaceState above clears ?resume, which re-runs this effect while the judge sign-in
    // keeps this component mounted (state updates after an unmount are a no-op).
    void takeResume().then((r) => {
      if (!r) return;
      setPark(r.park);
      setPickedBand(r.band);
      storeBand(r.band);
      setResumed(true);
      setStep("make");
      setAnnounce(stepAnnouncement("make"));
      setOpen(true);
    });
  }, [resume]);

  // Back from signing in with the park restored. The refreshed session can reach this component a moment after the
  // park is restored, so wait for it: as soon as the session shows signed in, say so (polite status) and move focus
  // to "Make my pass" (UX-4-03). A cancelled sign-in just keeps the heading focused.
  useEffect(() => {
    if (!resumed || !park || !signedInNow) return;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hand-off after the sign-in round trip */
    setResumed(false);
    setNote(signedInNote(judgeNow));
    /* eslint-enable react-hooks/set-state-in-effect */
    makeRef.current?.focus();
  }, [resumed, park, signedInNow, judgeNow]);

  // The pass is ready: show the moment, then open it (only while the wizard is open; a closed wizard offers a link).
  // Q-8-03: never for a request whose park/age is no longer the visitor's choice. UX-8-07: not once they chose to stay.
  const autoOpen = state.kind === "done" && open && step === "make" && !stayed && matchesChoice(running, park, band);
  useEffect(() => {
    if (state.kind === "done") {
      const href = `/pass/${state.pass.id}${state.cached ? "?reused=1" : ""}`;
      router.prefetch(href);
      if (!autoOpen) return;
      const t = setTimeout(() => {
        markPassFocus();
        router.push(href);
      }, READY_PAUSE_MS);
      return () => clearTimeout(t);
    }
    if (state.kind === "failed" || state.kind === "empty") resultRef.current?.focus();
  }, [state, router, autoOpen]);

  // UX-8-02: the ready moment takes focus (its heading), so keyboard users are not left on a removed button.
  const isDone = state.kind === "done";
  useEffect(() => {
    if (isDone && open) headingRef.current?.focus({ preventScroll: true });
  }, [isDone, open]);

  function onHeroSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const problem = checkQuery(query);
    if (problem) {
      setHeroError((p) => ({ message: problem, attempt: (p?.attempt ?? 0) + 1 }));
      heroInputRef.current?.focus();
      return;
    }
    setHeroError(null);
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    openWizard("park", (submitter as HTMLElement | null) ?? heroInputRef.current);
    search.search(query);
  }

  function onHeroLocate(e: MouseEvent<HTMLButtonElement>) {
    setHeroError(null);
    openWizard("park", e.currentTarget);
    search.locate();
  }

  function onPick(p: Park) {
    // Q-8-03: a new pick starts over. A pass still being made is no longer waited for (the stream is aborted, so its
    // answer is ignored; the server still finishes and saves it, so the same choice later opens at once).
    reset();
    setRunning(null);
    setStayed(false);
    setNote(null);
    setResumed(false);
    setPark(p);
    goTo("age");
  }

  /** Review MAJOR-2: from "not enough data", try another park from the same search with the same age (straight to step 3). */
  function onPickOther(p: Park) {
    reset();
    setRunning(null);
    setStayed(false);
    setNote(null);
    setPark(p);
    // Same step, so the step effect doesn't move focus: the picked button goes away, so focus "Make my pass".
    setStep("make");
    setAnnounce(`${safeParkName(p.name).name} picked. ${stepAnnouncement("make")}`);
    requestAnimationFrame(() => makeRef.current?.focus());
  }

  function onBand(b: AgeBand) {
    // Q-8-02: a different age clears an old failure, so its "Try again" can't send the old age.
    if (b !== band && !working) {
      reset();
      setRunning(null);
    }
    setPickedBand(b);
    storeBand(b);
  }

  /** Q-8-02: every request (first try and Try again) sends the CURRENT park and age. */
  function start(autoRetry: boolean) {
    if (!park || working) return;
    storeBand(band);
    setNote(null);
    setStayed(false);
    setRunning({ parkId: park.id, parkName: safeParkName(park.name).name, band });
    void run({ parkId: park.id, ageBand: band }, autoRetry ? { autoRetry: true } : {});
  }

  const make = () => start(true);
  const tryAgain = () => start(false);

  /** UX-8-07: a key or tap in the wizard during the ready moment pauses the auto-open (its own two buttons act themselves). */
  function pauseAutoOpen(e: { target: EventTarget }) {
    if (e.target instanceof Element && e.target.closest("[data-ready-actions]")) return;
    setStayed(true);
  }

  /** UX-8-07: stop the auto-open and keep the ready step on screen. */
  function stay() {
    setStayed(true);
    readyLinkRef.current?.focus();
  }

  const parkName = park ? safeParkName(park.name).name : null;
  // The labels of the pass being made (or just made): the request's own park and age.
  const runName = running?.parkName ?? parkName;
  const runBand = running?.band ?? band;
  const readyHref = state.kind === "done" ? `/pass/${state.pass.id}${state.cached ? "?reused=1" : ""}` : null;
  // Round 9 (Q-9-04): the earlier pass finished while the visitor is back on the park step: say so there too.
  const readyOnParkStep = open && step === "park" && state.kind === "done" && running !== null;
  const liveText = !open
    ? ""
    : step === "make" && state.kind === "done"
      ? readyAnnouncement(runName ?? "", state.cached, autoOpen)
      : readyOnParkStep
        ? parkStepReadyText(runName ?? "", state.cached)
        : announce;
  const showBack = (step === "age" || step === "make") && !working && state.kind !== "done";

  return (
    <section aria-labelledby={`${ids}-heading`} className="flex flex-col gap-4">
      <h2 id={`${ids}-heading`} className="sr-only">
        Find a park
      </h2>

      {/* The hero search card: just the place, Find parks, and Use my location. The rest happens in the wizard. */}
      <div className="flex flex-col gap-3 rounded-3xl bg-card p-4 text-card-foreground shadow-xl shadow-shadow ring-1 ring-border sm:p-5">
        <form aria-label="Find a park" noValidate onSubmit={onHeroSubmit} className="flex flex-col gap-2">
          <label htmlFor={heroInputId} className="sr-only">
            Town, ZIP or park name
          </label>
          <p id={heroHintId} className="sr-only">
            For example: Allen TX, a US ZIP like 75013, or Arbor Hills Nature Preserve.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <MapPin className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-primary" aria-hidden="true" />
              <input
                ref={heroInputRef}
                id={heroInputId}
                name="q"
                type="text"
                inputMode="search"
                autoComplete="address-level2"
                spellCheck={false}
                placeholder="Your town, ZIP or park name"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (heroError) setHeroError(null);
                }}
                aria-invalid={heroError ? true : undefined}
                aria-describedby={heroError ? `${heroHintId} ${heroErrorId}` : heroHintId}
                className="h-14 w-full rounded-2xl border border-line bg-background/60 pr-4 pl-12 text-base text-foreground placeholder:text-muted-foreground aria-invalid:border-2 aria-invalid:border-destructive"
              />
            </div>
            <button type="submit" className={buttonClassName("primary", "h-14 shrink-0 px-7")}>
              <Target className="size-5" aria-hidden="true" />
              Find parks
            </button>
          </div>
          {heroError ? (
            <p key={`q-${heroError.attempt}`} id={heroErrorId} role="alert" className="text-sm font-semibold text-destructive">
              {heroError.message}
            </p>
          ) : null}
        </form>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-2 text-sm">
          <button
            type="button"
            onClick={onHeroLocate}
            className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md font-semibold text-link underline-offset-4 hover:underline"
          >
            <LocateFixed className="size-4" aria-hidden="true" />
            Use my location
          </button>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground" data-testid="hero-steps-hint">
            {WIZARD_STEPS.map((s, i) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                {i > 0 ? <span aria-hidden="true">·</span> : null}
                <span className="inline-flex size-4.5 items-center justify-center rounded-full bg-muted text-[10px] font-extrabold text-foreground" aria-hidden="true">
                  {i + 1}
                </span>
                {s.label}
              </span>
            ))}
          </p>
        </div>
      </div>

      {/* The wizard was closed while a pass is on its way: a way back in (and to the ready pass). */}
      {!open && park && (state.kind === "working" || state.kind === "done" || state.kind === "failed") ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-sun px-4 py-3 text-sun-foreground" data-testid="wizard-pending">
          {state.kind === "working" ? <LoaderCircle className="size-5 motion-safe:animate-spin" aria-hidden="true" /> : <Sparkles className="size-5" aria-hidden="true" />}
          <p className="min-w-0 flex-1 font-semibold">
            {state.kind === "working"
              ? `Still making your pass for ${runName}…`
              : state.kind === "done"
                ? `Your pass for ${runName} is ready!`
                : `Your pass for ${runName} didn't finish.`}
          </p>
          {state.kind === "done" ? (
            <Link href={readyHref ?? "/"} onClick={markPassFocus} className="font-heading font-extrabold underline underline-offset-4">
              Open my pass
            </Link>
          ) : (
            <button type="button" className="min-h-11 font-heading font-extrabold underline underline-offset-4" onClick={(e) => openWizard("make", e.currentTarget)}>
              {state.kind === "working" ? "Show progress" : "See why"}
            </button>
          )}
        </div>
      ) : null}

      <dialog
        ref={dialogRef}
        className="gp-wizard"
        aria-labelledby={titleId}
        onClose={onClosed}
        data-testid="pass-wizard"
        // UX-8-07: a key or tap during the ready moment means the visitor is busy here; don't move them on.
        onKeyDown={autoOpen ? pauseAutoOpen : undefined}
        onPointerDown={autoOpen ? pauseAutoOpen : undefined}
      >
        <div className="gp-wizard-sheet">
          {/* The ticket's stub: ink band with the step trail and the close button. */}
          <header className="flex shrink-0 items-center gap-3 bg-band px-4 py-3 text-band-foreground sm:h-21 sm:px-7 sm:py-0">
            <span className="hidden font-heading text-sm font-extrabold tracking-wider uppercase sm:inline" aria-hidden="true">
              Grass Pass
            </span>
            <div className="min-w-0 flex-1 sm:flex sm:justify-center">
              <StepTrail step={step} finished={step === "make" && state.kind === "done"} />
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-band-foreground/10 text-band-foreground transition-colors hover:bg-band-foreground/20"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </header>

          <p role="status" aria-live="polite" className="sr-only" data-testid="wizard-announce">
            {liveText}
          </p>

          {/* The scrolling body is itself keyboard-reachable, so it can be scrolled with the keys while nothing in it is
              focusable (e.g. while the pass is being made). */}
          <div
            ref={bodyRef}
            tabIndex={0}
            role="region"
            aria-labelledby={titleId}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-6 pb-8 focus-visible:-outline-offset-4 sm:px-8 sm:pt-8"
          >
            <div className="mx-auto flex max-w-xl flex-col gap-5">
              <div className="flex flex-col gap-1">
                <p className="text-xs font-bold tracking-widest text-link uppercase" aria-hidden="true">
                  Step {stepIndex(step) + 1} of {WIZARD_STEPS.length}
                </p>
                <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-3xl leading-tight font-extrabold tracking-tight text-ink focus:outline-none sm:text-4xl">
                  {title}
                </h2>
                {step === "age" && parkName ? (
                  <p className="text-base text-muted-foreground">
                    For a pass at <strong className="text-foreground">{parkName}</strong>.
                  </p>
                ) : null}
              </div>

              {step === "park" && working ? (
                <div className="flex flex-col items-start gap-2 rounded-2xl bg-sun px-4 py-3 text-sun-foreground" data-testid="still-making-note">
                  <p className="font-semibold">
                    Your pass for {runName} is still being made. Picking a park below stops waiting for it and starts a new one.
                  </p>
                  <button type="button" onClick={() => goTo("make")} className="min-h-11 text-left font-heading font-extrabold underline underline-offset-4">
                    Back to my pass for {runName}
                  </button>
                </div>
              ) : null}

              {readyOnParkStep ? (
                <div className="flex flex-col items-start gap-2 rounded-2xl bg-sun px-4 py-3 text-sun-foreground" data-testid="ready-on-park-note">
                  <p className="font-semibold">{parkStepReadyText(runName ?? "", state.kind === "done" && state.cached)}</p>
                  <Link href={readyHref ?? "/"} onClick={markPassFocus} className="min-h-11 font-heading font-extrabold underline underline-offset-4">
                    Open my pass for {runName}
                  </Link>
                </div>
              ) : null}

              {step === "park" ? <ParkStep search={search} query={query} onQuery={setQuery} picked={park} onPick={onPick} /> : null}

              {step === "age" ? <AgeChoices band={band} onChange={onBand} legendId={`${ids}-age-legend`} /> : null}

              {step === "make" && park ? (
                <>
                  {notice}
                  {state.kind === "idle" || state.kind === "failed" || state.kind === "empty" ? (
                    <ChoiceTicket parkName={parkName ?? ""} band={band} onChangePark={() => goTo("park")} onChangeAge={() => goTo("age")} />
                  ) : null}

                  {/* Always in the dialog on step 3, so the sign-in note is announced when it appears (UX-4-03). */}
                  <p role="status" className={note ? "rounded-2xl bg-muted px-3 py-2 text-base font-semibold" : "sr-only"} data-testid="signed-in-note">
                    {note}
                  </p>

                  {state.kind === "idle" || state.kind === "failed" || state.kind === "empty" ? (
                    needsSignIn ? (
                      <div className="flex flex-col gap-4">
                        <Button variant="secondary" className="self-start" onClick={make}>
                          Open a pass someone already made today
                        </Button>
                        {account ? (
                          <SignInCard
                            id={`${ids}-signin`}
                            options={account.options}
                            returnTo="/?resume=1"
                            heading={
                              state.kind === "failed" && state.code === "SIGN_IN_REQUIRED" && account.signedIn
                                ? "Please sign in again to make this pass"
                                : "Sign in to make this pass"
                            }
                            onBeforeSignIn={() => rememberForSignIn(park, band)}
                          />
                        ) : null}
                      </div>
                    ) : null
                  ) : null}

                  {/* Making, then ready: ONE picture that stays mounted, so the ready moment only adds the last grass and the burst. */}
                  {state.kind === "working" || state.kind === "done" ? (
                    <div className="flex flex-col gap-4" data-testid={state.kind === "working" ? "making" : "pass-ready"}>
                      <p className="text-base text-muted-foreground">
                        For <strong className="text-foreground">{runName}</strong> · {ageLabel(runBand)}
                      </p>
                      <div className="overflow-hidden rounded-3xl bg-muted ring-1 ring-border">
                        <div className="mx-auto max-w-md px-2 pt-3">
                          <MakingScene stage={state.kind === "working" ? sceneStage(state.steps) : MAKING_PLAN.length - 1} ready={state.kind === "done"} />
                        </div>
                      </div>
                      {state.kind === "working" ? (
                        <>
                          <MakingChecklist steps={state.steps} />
                          {/* Kevin 2026-10-08: no "N s so far" counter; just how long a pass usually takes. */}
                          <p className="text-sm text-muted-foreground" data-testid="pass-elapsed">
                            {state.local ? LOCAL_WAIT_COPY : PASS_WAIT_COPY}
                          </p>
                        </>
                      ) : (
                        <div className="flex flex-col items-center gap-4 text-center">
                          {/* UX-8-02: the wizard's live region says it; this is the visible line (not a second live region). */}
                          <p className="text-lg font-semibold" data-testid="ready-line">
                            {state.cached ? "Someone already made this pass today." : `Your pass for ${runName} is ready.`}{" "}
                            {autoOpen ? "Opening it…" : "Open it when you like."}
                          </p>
                          <div className="flex flex-wrap justify-center gap-3" data-ready-actions>
                            <Link ref={readyLinkRef} href={readyHref ?? "/"} onClick={markPassFocus} className={buttonClassName("primary", "px-8 whitespace-nowrap")}>
                              Open my pass
                            </Link>
                            {autoOpen ? (
                              <Button variant="secondary" onClick={stay} className="whitespace-nowrap">
                                Stay here
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {state.kind === "failed" ? (
                    <div ref={resultRef} tabIndex={-1} className="flex flex-col gap-3 focus:outline-none">
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
                    <div ref={resultRef} tabIndex={-1} className="flex flex-col gap-3 focus:outline-none">
                      <div role="alert" className="rounded-2xl bg-muted p-4">
                        <p className="font-semibold">{state.message}</p>
                      </div>
                      <SectionNotes sections={state.sections} />
                      <OtherParks
                        from={park}
                        parks={search.phase.kind === "done" ? search.phase.result.parks : []}
                        onPick={onPickOther}
                        onSearch={() => goTo("park")}
                        headingId={`${ids}-other-parks`}
                      />
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>

          {/* The action bar: Back, and the step's main button. */}
          {showBack || (step === "make" && !needsSignIn && (state.kind === "idle" || state.kind === "failed" || state.kind === "empty")) ? (
            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-card px-5 py-4 sm:px-8">
              {showBack ? (
                <Button variant="secondary" onClick={() => goTo(step === "make" ? "age" : "park")} className="px-4 whitespace-nowrap sm:px-6">
                  <ArrowLeft className="size-5" aria-hidden="true" />
                  Back
                </Button>
              ) : (
                <span />
              )}
              {step === "age" ? (
                <Button onClick={() => goTo("make")} className="px-8">
                  Next
                </Button>
              ) : null}
              {/* Review MAJOR-2: "not enough data" can't be fixed by pressing the same button; the body offers other parks. */}
              {step === "make" && !needsSignIn && state.kind !== "empty" ? (
                <button ref={makeRef} type="button" onClick={make} className={buttonClassName("primary", "px-5 whitespace-nowrap min-[400px]:px-8")}>
                  <Sparkles className="size-5 max-[379px]:hidden" aria-hidden="true" />
                  Make my pass
                </button>
              ) : null}
            </footer>
          ) : null}
        </div>
      </dialog>
    </section>
  );
}

/**
 * Review 2026-10-08 MAJOR-2: after "not enough real data", up to 3 other parks from the visitor's own search (nearest to
 * this park first) and a way back to the search. Without a search on the page (e.g. back from signing in) it says so.
 */
export function OtherParks({
  from,
  parks,
  onPick,
  onSearch,
  headingId,
}: {
  from: Park;
  parks: readonly Park[];
  onPick: (p: Park) => void;
  onSearch: () => void;
  headingId: string;
}) {
  const others = otherParksNear(from, parks);
  const fromName = safeParkName(from.name).name;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-2xl p-4 ring-1 ring-border" data-testid="other-parks">
      <h3 id={headingId} className="font-heading text-xl font-extrabold">
        Try another park nearby
      </h3>
      {others.length > 0 ? (
        <>
          <p className="text-base text-muted-foreground">
            Bigger parks usually have more mapped things and wildlife sightings. These are the closest other parks from your search; we only
            know if one has enough data once you try it.
          </p>
          <ul className="flex flex-col gap-2">
            {others.map(({ park: p, fromM }) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className="flex min-h-11 w-full flex-col items-start rounded-xl bg-muted px-4 py-2 text-left hover:bg-muted/70"
                  data-testid="other-park"
                >
                  <span className="font-heading font-extrabold">{safeParkName(p.name).name}</span>
                  <span className="text-sm text-muted-foreground">
                    {distanceLabel(fromM)} from {fromName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-base text-muted-foreground" data-testid="other-parks-none">
          No data available: there are no other parks from a search on this page to suggest. Search again to see the parks near you.
        </p>
      )}
      <button type="button" onClick={onSearch} className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-link underline underline-offset-4">
        Search for a different park
      </button>
    </section>
  );
}

/** Step 3's summary as a little admission ticket: the real park name and the chosen age band. */
function ChoiceTicket({ parkName, band, onChangePark, onChangeAge }: { parkName: string; band: AgeBand; onChangePark: () => void; onChangeAge: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-paper text-ink ring-2 ring-ink" data-testid="choice-ticket">
      <div className="flex items-center justify-between bg-ink px-5 py-2 text-on-ink">
        <span className="font-heading text-sm font-extrabold tracking-wider uppercase">Your pass</span>
        <span className="rounded-full bg-sun px-2.5 py-0.5 text-xs font-bold text-sun-foreground" data-testid="chosen-age">
          {AGE_BAND_INFO[band].label}
        </span>
      </div>
      {/* Two equal columns: an "auto" column sized to the long age hint squeezed the park name to one letter wide (Kevin 2026-10-08). */}
      <dl className="grid gap-4 px-5 py-4 sm:grid-cols-2 sm:items-start">
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs font-bold tracking-widest text-muted-foreground uppercase">Park</dt>
          <dd className="font-heading text-2xl leading-tight font-extrabold break-words">{parkName}</dd>
          <dd>
            <button type="button" onClick={onChangePark} className="inline-flex min-h-11 items-center text-sm font-semibold text-link underline underline-offset-4">
              Change park
            </button>
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 border-t-2 border-dotted border-line pt-3 sm:border-t-0 sm:border-l-2 sm:pt-0 sm:pl-5">
          <dt className="text-xs font-bold tracking-widest text-muted-foreground uppercase">Explorer</dt>
          <dd className="text-base">
            <strong>{ageLabel(band)}</strong>: {AGE_BAND_INFO[band].hint}
          </dd>
          <dd>
            <button type="button" onClick={onChangeAge} className="inline-flex min-h-11 items-center text-sm font-semibold text-link underline underline-offset-4">
              Change age
            </button>
          </dd>
        </div>
      </dl>
    </div>
  );
}
