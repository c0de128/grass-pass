/**
 * Replays the LIVE SerpApi recordings in tests/fixtures/serpapi (S6, recorded 2026-10-06 13:45-14:00 UTC with
 * Kevin's free-plan key; trimmed to the fields the app reads, reviewer names/photos removed). A request is
 * answered only when its parameters are exactly a recorded request's (`search_parameters`, minus the
 * `google_domain` SerpApi adds), so a test can never pass on invented data. Anything else throws, or goes to
 * `next` (e.g. passReplay for OpenStreetMap, iNaturalist and the model).
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(process.cwd(), "tests/fixtures/serpapi");

export type SerpRecording = {
  _recording: { request: Record<string, string | number>; httpStatus: number; fetchedAt: string };
  search_parameters?: Record<string, string>;
  [k: string]: unknown;
};

export const serpFixture = (name: string) => JSON.parse(readFileSync(resolve(DIR, `${name}.json`), "utf8")) as SerpRecording;

/** Every recording that answers a search (not the 401). */
const RECORDINGS = readdirSync(DIR)
  .filter((f) => f.endsWith(".json") && !f.startsWith("error-"))
  .map((f) => serpFixture(f.replace(/\.json$/, "")));

const norm = (p: Record<string, string | number>) =>
  JSON.stringify(
    Object.entries(p)
      .filter(([k]) => k !== "google_domain" && k !== "api_key")
      .map(([k, v]) => [k, String(v)])
      .sort(([a], [b]) => a.localeCompare(b)),
  );

/** The recorded answer body for these exact parameters, or undefined. */
export function recordedSerp(params: Record<string, string>): SerpRecording | undefined {
  const want = norm(params);
  return RECORDINGS.find((r) => norm(r._recording.request) === want);
}

/** The body SerpApi sent (the recording minus our `_recording` label). */
export function serpBody(r: SerpRecording): Record<string, unknown> {
  const { _recording: _drop, ...body } = r;
  void _drop;
  return body;
}

export type SerpCall = { url: string; params: Record<string, string>; init?: RequestInit };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function serpReplay(opts: {
  /** Replace an answer (a built failure, or a derived page): return a Response, or undefined for the recording. */
  answer?: (call: SerpCall) => Response | undefined | Promise<Response | undefined>;
  next?: (url: string, init?: RequestInit) => Promise<Response>;
} = {}) {
  const calls: SerpCall[] = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    if (u.host !== "serpapi.com") {
      if (opts.next) return opts.next(url, init);
      throw new Error(`no recording for ${u.host}`);
    }
    const params = Object.fromEntries(u.searchParams.entries());
    const call: SerpCall = { url, params, init };
    calls.push(call);
    const o = await opts.answer?.(call);
    if (o) return o;
    const r = recordedSerp(params);
    if (!r) throw new Error(`no SerpApi recording for ${params.engine} ${params.q ?? params.query ?? ""}`);
    return json(serpBody(r), r._recording.httpStatus);
  };
  return { fetchImpl, calls };
}
