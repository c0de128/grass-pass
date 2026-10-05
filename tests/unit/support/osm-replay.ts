/**
 * Replays the LIVE recordings in tests/fixtures (Nominatim + Overpass, recorded 2026-10-05 with
 * fetch times in each file's `_recording`). Anything without a recording throws, so a test can
 * never pass on invented data. Failure shapes that cannot be recorded on demand (a hung socket,
 * a 429) are built in the individual tests and say so.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Recording = { _recording: { status: number; contentType?: string | null; center?: { lat: number; lng: number } }; body: unknown };

const FIXTURES = resolve(process.cwd(), "tests/fixtures");

export function fixture(name: string): Recording {
  return JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), "utf8")) as Recording;
}

/** A Response with the recorded status, content type and body. */
export function recordedResponse(name: string): Response {
  const r = fixture(name);
  const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
  return new Response(text, {
    status: r._recording.status,
    headers: { "content-type": r._recording.contentType ?? "application/json" },
  });
}

/** Nominatim query text (lower-cased) → recording name. */
export const NOMINATIM_RECORDINGS: Record<string, string> = {
  "allen tx": "nominatim-allen-tx",
  "connemara meadow preserve": "nominatim-connemara-meadow-preserve",
  "celebration park allen tx": "nominatim-celebration-park-allen-tx",
  "zzqxjv nowhere plorf": "nominatim-no-match",
};

export const OVERPASS_RECORDINGS = [
  "overpass-parks-allen-tx",
  "overpass-parks-connemara-meadow-preserve",
  "overpass-parks-celebration-park-allen-tx",
  "overpass-parks-empty-west-texas",
];

export type Call = { url: string; init?: RequestInit; query?: string };

/** The `around:` point in an Overpass query. */
export function aroundPoint(query: string): { lat: number; lng: number } | null {
  const m = query.match(/around:\d+,(-?[\d.]+),(-?[\d.]+)\)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

/** Find the Overpass recording made for this exact point (5 decimals). */
export function overpassRecordingFor(query: string): string | null {
  const p = aroundPoint(query);
  if (!p) return null;
  for (const name of OVERPASS_RECORDINGS) {
    const c = fixture(name)._recording.center;
    if (c && c.lat.toFixed(5) === p.lat.toFixed(5) && c.lng.toFixed(5) === p.lng.toFixed(5)) return name;
  }
  return null;
}

/** A fetch that answers from the recordings and logs every call. */
export function osmReplay(overrides: { overpass?: (call: Call) => Response | Promise<Response> | undefined } = {}) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    if (u.host === "nominatim.openstreetmap.org") {
      calls.push({ url, init });
      const q = (u.searchParams.get("q") ?? "").toLowerCase();
      const name = NOMINATIM_RECORDINGS[q];
      if (!name) throw new Error(`no Nominatim recording for "${q}"`);
      return recordedResponse(name);
    }
    const query = new URLSearchParams(String(init?.body ?? "")).get("data") ?? "";
    const call = { url, init, query };
    calls.push(call);
    const o = await overrides.overpass?.(call);
    if (o) return o;
    const name = overpassRecordingFor(query);
    if (!name) throw new Error(`no Overpass recording for ${JSON.stringify(aroundPoint(query))}`);
    return recordedResponse(name);
  };
  return { fetchImpl, calls };
}
