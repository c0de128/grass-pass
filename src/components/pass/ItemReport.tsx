"use client";

/**
 * Report buttons under one find on the SCREEN pass (never on the printed one): "Found it", "Didn't find it",
 * "Not safe" (asks once more first). Signed-in grown-ups only; one report per item per day. The state is
 * honest: "Sending…" until the server answers, then its answer ("Thanks — counted." / "already reported
 * today" / for the judge demo "logged for us to review, but they don't change passes") or the real error. The result is announced to screen readers (role=status).
 */
import { useState } from "react";
import { z } from "@/lib/zod-config";
import type { ReportKind } from "@/lib/reports/kinds";

const AnswerSchema = z.object({ status: z.enum(["counted", "duplicate", "logged"]), message: z.string().max(200) });
const ErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string().max(300) }) });

const LABELS: Record<ReportKind, string> = { found: "Found it", notfound: "Didn't find it", unsafe: "Not safe" };

type State =
  | { kind: "idle" }
  | { kind: "confirm-unsafe" }
  | { kind: "sending"; report: ReportKind }
  | { kind: "done"; report: ReportKind; message: string }
  | { kind: "failed"; message: string };

export function ItemReport({ passId, itemRef, findNumber }: { passId: string; itemRef: string; findNumber: number }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const busy = state.kind === "sending";
  const done = state.kind === "done";

  async function send(report: ReportKind) {
    if (busy || done) return;
    setState({ kind: "sending", report });
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ passId, ref: itemRef, kind: report }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (res.ok) {
        const a = AnswerSchema.safeParse(json);
        setState(a.success ? { kind: "done", report, message: a.data.message } : { kind: "failed", message: "Something went wrong reading the answer. Please try again." });
        return;
      }
      const e = ErrorSchema.safeParse(json);
      setState({ kind: "failed", message: e.success ? e.data.error.message : `The report wasn't saved (error ${res.status}). Please try again.` });
    } catch {
      setState({ kind: "failed", message: "We couldn't reach Grass Pass. Check your internet connection and try again." });
    }
  }

  const button = (report: ReportKind, onClick: () => void) => {
    const pressed = (state.kind === "sending" || state.kind === "done") && state.report === report;
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={pressed}
        aria-disabled={busy || done || undefined}
        className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold ring-2 ring-line ring-inset aria-disabled:cursor-not-allowed ${
          pressed ? "bg-ink text-on-ink" : "bg-card text-foreground hover:bg-muted"
        }`}
      >
        {LABELS[report]}
      </button>
    );
  };

  return (
    <div className="mt-1 flex flex-col gap-1 print:hidden" role="group" aria-label={`Report find ${findNumber}`}>
      {state.kind === "confirm-unsafe" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">Report find {findNumber} as not safe? Grown-ups only, please.</p>
          <button
            type="button"
            onClick={() => void send("unsafe")}
            className="inline-flex min-h-11 items-center rounded-full bg-ink px-3 text-sm font-semibold text-on-ink"
          >
            Yes, it&apos;s not safe
          </button>
          <button
            type="button"
            onClick={() => setState({ kind: "idle" })}
            className="inline-flex min-h-11 items-center rounded-full bg-card px-3 text-sm font-semibold ring-2 ring-line ring-inset"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {button("found", () => void send("found"))}
          {button("notfound", () => void send("notfound"))}
          {button("unsafe", () => {
            if (!busy && !done) setState({ kind: "confirm-unsafe" });
          })}
        </div>
      )}
      <p role="status" className="min-h-5 text-sm" data-testid="report-status">
        {state.kind === "sending" ? "Sending…" : state.kind === "done" ? state.message : state.kind === "failed" ? state.message : ""}
      </p>
    </div>
  );
}
