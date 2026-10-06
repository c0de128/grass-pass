/**
 * POST /api/pass  { parkId: "way/306191453", ageBand: "6-10", fresh?: true }
 *
 * Guards first (same origin 403, JSON 415, 2 KB streamed body cap 413, zod 400), then limits, caches
 * and the build in src/lib/pass/make.ts (a route file may only export handlers).
 *
 * Answers:
 * - a refusal or failure before any work started: JSON `{ error }` with its HTTP status (+ Retry-After);
 * - otherwise `200 application/x-ndjson`: one `{"type":"step"}` line per real step as it happens
 *   ("Reading the park map...", "Writing clues with <model>..."), then ONE final line:
 *   `result` (the pass), `empty` (no usable data) or `error` (with its status and, for model
 *   failures, the real park data).
 * R2-M3: a failure caused by the map data (OpenStreetMap busy/slow) carries a ready example pass link.
 * R2-m5: background OpenStreetMap refreshes started by this request are kept alive with after(), so a
 * serverless instance doesn't freeze them half-way while they hold their 6 h lock. SEC-3-06: only the
 * refreshes THIS request queued, not the whole process queue.
 * Accounts (2026-10-06): a NEW pass needs a signed-in grown-up (401 SIGN_IN_REQUIRED otherwise); today's
 * saved pass for the park + age is served to anyone. Only the account key in the session cookie is used.
 */
import { WaiterAbortedError } from "@/lib/cache";
import { runAfterResponse } from "@/lib/after";
import { guardJsonPost } from "@/lib/http/guard";
import { jsonError } from "@/lib/http/respond";
import { clientIp } from "@/lib/limits";
import { readAccount } from "@/lib/accounts/session";
import { makePass, type MakeOutcome } from "@/lib/pass/make";
import { EXAMPLE_PARKS, readyExample } from "@/lib/prewarm";
import { MAP_DATA_FAILURE_CODES, PassRequestSchema, type PassLine } from "@/lib/pass/schema";
import { withRefreshScope } from "@/lib/sources/osm-refresh";

export const runtime = "nodejs";
/** Overpass (<= 50 s) + iNaturalist + the model (30 s) are cut by an 85 s pass deadline. */
export const maxDuration = 90;

const NDJSON = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

type ErrorOutcome = Extract<MakeOutcome, { kind: "error" }>;

/** The error body, plus a ready example pass when the map data was the problem (never throws). */
async function errorBody(o: ErrorOutcome): Promise<Extract<PassLine, { type: "error" }>["error"]> {
  if (!MAP_DATA_FAILURE_CODES.includes(o.error.code)) return o.error;
  const example = await readyExample().catch(() => null);
  return example ? { ...o.error, example } : o.error;
}

async function finalLine(o: MakeOutcome): Promise<PassLine> {
  if (o.kind === "pass") return { type: "result", pass: o.pass, cached: o.cached };
  if (o.kind === "empty") return { type: "empty", parkName: o.parkName, message: o.message, sections: o.sections };
  return { type: "error", status: o.status, error: await errorBody(o), ...(o.parkData ? { parkData: o.parkData } : {}) };
}

async function errorResponse(o: ErrorOutcome): Promise<Response> {
  const error = await errorBody(o);
  if (!o.parkData && !error.example) return jsonError(o.status, o.error);
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (o.error.retryAfter) headers["Retry-After"] = String(Math.ceil(o.error.retryAfter));
  return Response.json({ error, ...(o.parkData ? { parkData: o.parkData } : {}) }, { status: o.status, headers });
}

export async function POST(req: Request): Promise<Response> {
  const g = await guardJsonPost(req, PassRequestSchema);
  if (!g.ok) return jsonError(g.failure.status, { code: g.failure.code, message: g.failure.message });

  const account = await readAccount(req);
  const enc = new TextEncoder();
  const pending: PassLine[] = [];
  let push: ((l: PassLine) => void) | null = null;
  let firstStep!: () => void;
  const started = new Promise<"step">((r) => (firstStep = () => r("step")));

  // R2-m5 / SEC-3-06: background map refreshes this request queues finish after the response, never frozen.
  const scoped = withRefreshScope(() =>
    makePass(g.data, {
      ip: clientIp(req),
      // The example parks may use the reserved slice of the AI budget (SEC-1-05).
      reserved: EXAMPLE_PARKS.some((e) => e.parkId === g.data.parkId),
      requireAccount: true,
      account,
      signal: req.signal,
      onStep: ({ step, text }) => {
        const line: PassLine = { type: "step", step, text };
        if (push) push(line);
        else pending.push(line);
        firstStep();
      },
    }),
  );
  runAfterResponse(() => scoped.idle());
  const work = scoped.result.then(
    (o) => ({ ok: true as const, o }),
    (e: unknown) => ({ ok: false as const, e }),
  );

  const first = await Promise.race([work.then(() => "done" as const), started]);
  if (first === "done") {
    const r = await work;
    if (!r.ok) {
      if (r.e instanceof WaiterAbortedError) return new Response(null, { status: 499 });
      throw r.e;
    }
    // Answered without any slow step (cache hit, refusal): no stream needed.
    if (r.o.kind === "error") return errorResponse(r.o);
    return new Response(`${JSON.stringify(await finalLine(r.o))}\n`, { status: 200, headers: NDJSON });
  }

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (l: PassLine) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(l)}\n`));
        } catch {
          open = false; // the client went away; the build keeps going and is cached
        }
      };
      for (const l of pending.splice(0)) write(l);
      push = write;
      const r = await work;
      push = null;
      if (r.ok) write(await finalLine(r.o));
      else if (!(r.e instanceof WaiterAbortedError)) {
        write({ type: "error", status: 500, error: { code: "INTERNAL", message: "Something went wrong making the pass. Please try again." } });
      }
      if (open) controller.close();
    },
  });
  return new Response(body, { status: 200, headers: NDJSON });
}
