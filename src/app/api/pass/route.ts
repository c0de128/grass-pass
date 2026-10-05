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
 */
import { WaiterAbortedError } from "@/lib/cache";
import { guardJsonPost } from "@/lib/http/guard";
import { jsonError } from "@/lib/http/respond";
import { clientIp } from "@/lib/limits";
import { makePass, type MakeOutcome } from "@/lib/pass/make";
import { PassRequestSchema, type PassLine } from "@/lib/pass/schema";

export const runtime = "nodejs";
/** Overpass (<= 50 s) + iNaturalist + the model (30 s) are cut by an 85 s pass deadline. */
export const maxDuration = 90;

const NDJSON = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function finalLine(o: MakeOutcome): PassLine {
  if (o.kind === "pass") return { type: "result", pass: o.pass, cached: o.cached };
  if (o.kind === "empty") return { type: "empty", parkName: o.parkName, message: o.message, sections: o.sections };
  return { type: "error", status: o.status, error: o.error, ...(o.parkData ? { parkData: o.parkData } : {}) };
}

function errorResponse(o: Extract<MakeOutcome, { kind: "error" }>): Response {
  if (!o.parkData) return jsonError(o.status, o.error);
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (o.error.retryAfter) headers["Retry-After"] = String(Math.ceil(o.error.retryAfter));
  return Response.json({ error: o.error, parkData: o.parkData }, { status: o.status, headers });
}

export async function POST(req: Request): Promise<Response> {
  const g = await guardJsonPost(req, PassRequestSchema);
  if (!g.ok) return jsonError(g.failure.status, { code: g.failure.code, message: g.failure.message });

  const enc = new TextEncoder();
  const pending: PassLine[] = [];
  let push: ((l: PassLine) => void) | null = null;
  let firstStep!: () => void;
  const started = new Promise<"step">((r) => (firstStep = () => r("step")));

  const work = makePass(g.data, {
    ip: clientIp(req),
    signal: req.signal,
    onStep: ({ step, text }) => {
      const line: PassLine = { type: "step", step, text };
      if (push) push(line);
      else pending.push(line);
      firstStep();
    },
  }).then(
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
    return new Response(`${JSON.stringify(finalLine(r.o))}\n`, { status: 200, headers: NDJSON });
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
      if (r.ok) write(finalLine(r.o));
      else if (!(r.e instanceof WaiterAbortedError)) {
        write({ type: "error", status: 500, error: { code: "INTERNAL", message: "Something went wrong making the pass. Please try again." } });
      }
      if (open) controller.close();
    },
  });
  return new Response(body, { status: 200, headers: NDJSON });
}
