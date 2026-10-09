"use client";

/**
 * "How was this pass?" (Kevin, 2026-10-08) on the SCREEN pass (never printed). A signed-in grown-up picks 1-5 stars and
 * any tags (Too easy, Too hard, Kids loved it, Something was missing, Not safe) and sends them; there is no text box at
 * all. One rating per account per pass, the newest counts. The state is honest: "Sending…" until the server answers,
 * then its own answer (saved / updated / judge demo logged only) or the real error, announced with role=status.
 * Signed out: "Sign in to rate this pass" (a link to /signin that comes back here).
 * The per-find Found it / Didn't find it / Not safe reports (ItemReport.tsx) are separate and unchanged.
 */
import { Star } from "lucide-react";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { buttonClassName } from "@/components/ui/Button";
import { z } from "@/lib/zod-config";
import { FEEDBACK_COPY, FEEDBACK_TAG_LABELS, FEEDBACK_TAGS, FeedbackResponseSchema, type FeedbackTag } from "@/lib/feedback/kinds";

const ErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string().max(300) }) });

type Sent = { kind: "idle" } | { kind: "sending" } | { kind: "done"; message: string } | { kind: "failed"; message: string };

export function PassFeedback({ passId, signedIn, judge = false }: { passId: string; signedIn: boolean; judge?: boolean }) {
  const ids = useId();
  const headingId = `${ids}-heading`;
  const starsErrorId = `${ids}-stars-error`;
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<FeedbackTag[]>([]);
  const [sent, setSent] = useState<Sent>({ kind: "idle" });
  const [starsError, setStarsError] = useState<{ attempt: number } | null>(null);
  const busy = sent.kind === "sending";

  if (!signedIn) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col items-start gap-2 rounded-2xl bg-muted p-4 print:hidden" data-testid="pass-feedback">
        <h2 id={headingId} className="font-heading text-xl font-extrabold text-ink">
          {FEEDBACK_COPY.heading}
        </h2>
        <p className="text-base">Ratings are for signed-in grown-ups. Stars and a few tags, no typing.</p>
        <Link href={`/signin?from=${encodeURIComponent(`/pass/${passId}`)}`} prefetch={false} className={buttonClassName("secondary")}>
          {FEEDBACK_COPY.signedOut}
        </Link>
      </section>
    );
  }

  function toggle(t: FeedbackTag) {
    if (busy) return;
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
    if (sent.kind !== "idle") setSent({ kind: "idle" });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (stars < 1) {
      setStarsError((p) => ({ attempt: (p?.attempt ?? 0) + 1 }));
      document.getElementById(`${ids}-star-1`)?.focus();
      return;
    }
    setStarsError(null);
    setSent({ kind: "sending" });
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ passId, stars, tags: FEEDBACK_TAGS.filter((t) => tags.includes(t)) }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (res.ok) {
        const a = FeedbackResponseSchema.safeParse(json);
        setSent(a.success ? { kind: "done", message: a.data.message } : { kind: "failed", message: "Something went wrong reading the answer. Please try again." });
        return;
      }
      const err = ErrorSchema.safeParse(json);
      setSent({ kind: "failed", message: err.success ? err.data.error.message : `The rating wasn't saved (error ${res.status}). Please try again.` });
    } catch {
      setSent({ kind: "failed", message: "We couldn't reach Grass Pass. Check your internet connection and try again." });
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-2xl bg-muted p-4 sm:p-5 print:hidden" data-testid="pass-feedback">
      <h2 id={headingId} className="font-heading text-xl font-extrabold text-ink">
        {FEEDBACK_COPY.heading}
      </h2>
      <p className="text-base">{FEEDBACK_COPY.intro}</p>
      <form aria-label="Rate this pass" noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
        <fieldset
          className="flex flex-col gap-1"
          aria-invalid={starsError ? true : undefined}
          aria-describedby={starsError ? starsErrorId : undefined}
        >
          <legend className="mb-1 text-sm font-bold">Stars</legend>
          <div className="flex flex-wrap gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className="relative">
                <input
                  type="radio"
                  id={`${ids}-star-${n}`}
                  name={`${ids}-stars`}
                  value={n}
                  checked={stars === n}
                  onChange={() => {
                    setStars(n);
                    setStarsError(null);
                    if (sent.kind !== "idle") setSent({ kind: "idle" });
                  }}
                  className="peer sr-only"
                />
                <label
                  htmlFor={`${ids}-star-${n}`}
                  className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-ink peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-focus-visible:outline-solid hover:bg-card"
                >
                  <Star className={`size-7 ${n <= stars ? "fill-sun stroke-ink" : "stroke-ink"}`} aria-hidden="true" />
                  <span className="sr-only">
                    {n} {n === 1 ? "star" : "stars"}
                  </span>
                </label>
              </span>
            ))}
          </div>
          {starsError ? (
            <p id={starsErrorId} role="alert" key={starsError.attempt} className="text-sm font-semibold text-destructive">
              {FEEDBACK_COPY.pickStars}
            </p>
          ) : null}
        </fieldset>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-bold">Tags (pick any)</legend>
          <div className="flex flex-wrap gap-2">
            {FEEDBACK_TAGS.map((t) => {
              const on = tags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(t)}
                  className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold ring-2 ring-line ring-inset ${
                    on ? "bg-ink text-on-ink" : "bg-card text-foreground hover:bg-muted"
                  }`}
                >
                  {FEEDBACK_TAG_LABELS[t]}
                </button>
              );
            })}
          </div>
        </fieldset>
        <button type="submit" aria-disabled={busy || undefined} className={buttonClassName("primary", "self-start")}>
          {busy ? "Sending…" : "Send rating"}
        </button>
      </form>
      <p role="status" className="min-h-5 text-sm font-semibold" data-testid="feedback-status">
        {sent.kind === "sending" ? "Sending…" : sent.kind === "done" || sent.kind === "failed" ? sent.message : ""}
      </p>
      <p className="text-sm text-muted-foreground">
        {FEEDBACK_COPY.privacy}
        {judge ? " Judge demo ratings are logged for review, but they aren't counted." : ""}
      </p>
    </section>
  );
}
