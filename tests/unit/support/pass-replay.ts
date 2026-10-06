/**
 * Replays the LIVE S3 recordings (Overpass park features, iNaturalist species + taxa, and the real
 * gemma-4-31B-it answers from DigitalOcean, all recorded 2026-10-05 ~23:13-23:16 UTC; S5 added the Overpass
 * geometry recordings and re-recorded the Celebration answer with its Find This Spot target, 2026-10-06
 * ~00:25-00:33 UTC). Requests with
 * no recording throw, so a test can never pass on invented data. Failure shapes that can't be recorded
 * on demand (a hung model, a 5xx) are built inside the tests that need them, and say so.
 */
import { PARK_FILTER } from "@/lib/sources/overpass-features";
import { withoutMaxsize } from "@/lib/sources/overpass";
import { fixture } from "./osm-replay";

export const PARKS = {
  connemara: { id: "way/306191453", slug: "connemara-meadow-preserve", name: "Connemara Meadow Preserve" },
  celebration: { id: "way/188145317", slug: "celebration-park", name: "Celebration Park" },
} as const;

type Rec = { _recording: Record<string, unknown> & { status?: number; recordedAtMs?: number }; body: unknown };
type ModelRec = { _recording: { recordedAtMs: number }; request: { messages: { role: string; content: string }[]; response_format: { json_schema: { schema: unknown } } }; response: unknown };

export const rec = (name: string) => fixture(name) as unknown as Rec;

type PhenologyRec = {
  _recording: { month: number; taxonIds: number[]; recordedAt: string };
  exchanges: { url: string; status: number; body: unknown }[];
};
/** The live phenology answers for a park (R1-M4 season check). */
export const phenologyRec = (slug: string) => fixture(`inat-phenology-${slug}`) as unknown as PhenologyRec;
export const modelRec = (slug: string) => fixture(`do-gemma-4-31b-it-${slug}-pass`) as unknown as ModelRec;

/** When the Connemara park data was recorded (the 14-day window and "today" in tests). The model answers were re-recorded later (S8b) from these same inputs. */
export const RECORDED_AT = rec(`inat-species-${PARKS.connemara.slug}`)._recording.recordedAtMs as number;

/** The recorded model answer's content (the JSON the model wrote). */
export function recordedDraft(slug: string): unknown {
  const r = modelRec(slug).response as { choices: { message: { content: string } }[] };
  return JSON.parse(r.choices[0].message.content);
}

export type Call = { url: string; host: string; init?: RequestInit; body?: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * One fetch for everything the pass touches. `model` overrides the model answer (e.g. a delay or a
 * 5xx built in a test); by default the recorded answer for the park named in the prompt is returned.
 */
export function passReplay(opts: { model?: (call: Call) => Response | undefined | Promise<Response | undefined> } = {}) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const body = typeof init?.body === "string" ? init.body : undefined;
    const call: Call = { url, host: u.host, init, body };
    calls.push(call);

    if (u.host === "inference.do-ai.run") {
      const o = await opts.model?.(call);
      if (o) return o;
      const sent = JSON.parse(body ?? "{}") as { messages?: { content: string }[] };
      const user = sent.messages?.[1]?.content ?? "";
      for (const p of Object.values(PARKS)) {
        if (user.includes(`kind="park name">${p.name}</source>`)) return json(modelRec(p.slug).response);
      }
      throw new Error("no model recording for this prompt");
    }
    if (u.pathname.endsWith("/interpreter")) {
      const q = new URLSearchParams(body ?? "").get("data") ?? "";
      for (const p of Object.values(PARKS)) {
        const [type, id] = p.id.split("/");
        if (!q.includes(`${type}(${id})`)) continue;
        // S5: the Find This Spot geometry query (`out geom`), recorded live 2026-10-06 ~00:25 UTC.
        if (q.includes("out geom")) {
          const g = rec(`overpass-geometry-${p.slug}`);
          // R1 (SEC-1-01) added the park tag filter to the `.p` selector. Re-recorded live 2026-10-06
          // ~03:15 UTC with the filter (src/data/osm/examples.json): both parks parse identically, so the
          // recording answers the filtered query too. Any other change to the query is still an error.
          if (g._recording.overpassQuery !== withoutMaxsize(q).replace(PARK_FILTER, "")) throw new Error(`geometry query changed since the recording for ${p.id}`);
          return json(g.body);
        }
        return json(rec(`overpass-features-${p.slug}`).body);
      }
      throw new Error(`no Overpass recording for ${q.slice(0, 80)}`);
    }
    if (u.host === "api.inaturalist.org" && u.pathname === "/v1/observations/species_counts" && u.searchParams.has("term_id")) {
      // R1-M4 season check: "Flowers and Fruits" annotation counts, recorded live 2026-10-06 (Connemara only;
      // Celebration has no species, so no plant ids and no call). Only the exact recorded URL is answered.
      const r = phenologyRec(PARKS.connemara.slug);
      const hit = r.exchanges.find((e) => e.url === url);
      if (hit) return json(hit.body, hit.status);
      throw new Error(`no phenology recording for ${u.search}`);
    }
    if (u.host === "api.inaturalist.org" && u.pathname === "/v1/observations/species_counts") {
      for (const p of Object.values(PARKS)) {
        const r = rec(`inat-species-${p.slug}`);
        const ru = new URL(String(r._recording.url));
        if (ru.searchParams.get("lat") === u.searchParams.get("lat") && ru.searchParams.get("lng") === u.searchParams.get("lng")) {
          return json(r.body);
        }
      }
      throw new Error(`no species_counts recording for ${u.search}`);
    }
    if (u.host === "api.inaturalist.org" && (u.pathname === "/v1/observations/histogram" || u.pathname === "/v1/observations")) {
      // S7 October box: only the exact recorded URL (same park, same 14-day window) is answered.
      const kind = u.pathname.endsWith("/histogram") ? "monarch-histogram" : "milkweed-count";
      for (const p of Object.values(PARKS)) {
        const r = rec(`inat-${kind}-${p.slug}`);
        if (r._recording.url === url) return json(r.body);
      }
      throw new Error(`no ${kind} recording for ${u.search}`);
    }
    if (u.host === "api.inaturalist.org" && u.pathname.startsWith("/v1/taxa/")) {
      return json(rec(`inat-taxa-${PARKS.connemara.slug}`).body);
    }
    throw new Error(`no recording for ${url}`);
  };
  return { fetchImpl, calls };
}
