/**
 * Replays the LIVE S3 recordings (Overpass park features, iNaturalist species + taxa, and the real
 * gemma-4-31B-it answers from DigitalOcean, all recorded 2026-10-05 ~23:13-23:16 UTC; S5 added the Overpass
 * geometry recordings and re-recorded the Celebration answer with its Find This Spot target, 2026-10-06
 * ~00:25-00:33 UTC). Requests with
 * no recording throw, so a test can never pass on invented data. Failure shapes that can't be recorded
 * on demand (a hung model, a 5xx) are built inside the tests that need them, and say so.
 */
import { kidWordsRule } from "@/lib/ai/prompt";
import { setRecordedFactsForTests } from "@/lib/pool/park";
import { PARK_FILTER } from "@/lib/sources/overpass-features";
import { withoutMaxsize } from "@/lib/sources/overpass";
import { fixture } from "./osm-replay";

export const PARKS = {
  connemara: { id: "way/306191453", slug: "connemara-meadow-preserve", name: "Connemara Meadow Preserve" },
  celebration: { id: "way/188145317", slug: "celebration-park", name: "Celebration Park" },
} as const;

type Rec = { _recording: Record<string, unknown> & { status?: number; recordedAtMs?: number }; body: unknown };
type ModelRequest = { messages: { role: string; content: string }[]; response_format: { json_schema: { schema: unknown } } };
/**
 * `refill` (content tuning, Connemara): the real second call, the refill of what the first answer did not fill.
 * `refill2` (completeness, 2026-10-06): the real third call, a second refill when the first one still left the pass short.
 */
type ModelRec = {
  _recording: { recordedAtMs: number };
  request: ModelRequest;
  response: unknown;
  refill?: { request: ModelRequest; response: unknown };
  refill2?: { request: ModelRequest; response: unknown };
};

/** The refill call's system prompt says so (prompt.ts refillRules). */
export const REFILL_MARK = "- This is a second try:";

export const rec = (name: string) => fixture(name) as unknown as Rec;

type PhenologyRec = {
  _recording: { month: number; taxonIds: number[]; recordedAt: string; taxonIdsR7?: number[] };
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
  // Round-6 C4: the recorded answers were written for the creek and fountain facts in their own requests.
  setRecordedFactsForTests(recordedParkFacts());
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
      const isRefill = (sent.messages?.[0]?.content ?? "").includes(REFILL_MARK);
      for (const p of Object.values(PARKS)) {
        if (!user.includes(`kind="park name">${p.name}</source>`)) continue;
        const m = modelRec(p.slug);
        // A refill gets the recorded refill whose request is exactly the one sent (the second refill differs
        // from the first: other ids, the taken first words); else the first recorded refill, else the first answer.
        if (isRefill) {
          // Audit R5-C3: compared without the kid-words line and the (now cleaned) Wild Finds texts (`recordedShape`).
          const same = [m.refill, m.refill2].find((r) => r && JSON.stringify(recordedShape(r.request.messages)) === JSON.stringify(recordedShape((sent.messages ?? []) as { role: string; content: string }[])));
          if (same) return json(same.response);
          if (m.refill) return json(m.refill.response);
        }
        return json(m.response);
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
        // Audit Q-3-04 moved the window's end to yesterday: a recorded histogram whose range covers the
        // asked one answers it, cut to the asked days (derived from the live answer, nothing added).
        if (kind === "monarch-histogram") {
          const cut = histogramWithin(r, u);
          if (cut) return json(cut);
        }
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

/**
 * A recorded monarch histogram cut to a smaller asked range (same park point, radius and filters; only
 * d1/d2 differ and lie inside the recorded range), or null. Derived from the live recording: only days
 * outside the asked range are removed (audit Q-3-04 moved the window's end to yesterday).
 */
export function histogramWithin(r: { _recording: Record<string, unknown>; body: unknown }, asked: URL): unknown | null {
  const recUrl = new URL(String(r._recording.url));
  const other = (u: URL) => [...u.searchParams].filter(([k]) => k !== "d1" && k !== "d2").sort().join("&");
  if (recUrl.origin + recUrl.pathname !== asked.origin + asked.pathname || other(recUrl) !== other(asked)) return null;
  const [d1, d2] = [asked.searchParams.get("d1") ?? "", asked.searchParams.get("d2") ?? ""];
  if (d1 < (recUrl.searchParams.get("d1") ?? "") || d2 > (recUrl.searchParams.get("d2") ?? "")) return null;
  const body = r.body as { results: { day: Record<string, number> } };
  const day = Object.fromEntries(Object.entries(body.results.day).filter(([k]) => k >= d1 && k <= d2));
  return { ...body, results: { ...body.results, day } };
}

/**
 * Audit R5-C3 (2026-10-06): the live model recordings were made before the kid-words rule
 * (prompt.ts `kidWordsRule`) joined the system prompt. Everything else in today's request is still
 * byte-for-byte the recorded one; this takes that one line out so the tests keep proving it. The
 * recorded answers are therefore answers to the prompt without that line (said in the R5 report).
 */
export function withoutKidWordsRule<T extends { role: string; content: string }>(messages: readonly T[]): T[] {
  const line = kidWordsRule();
  return messages.map((m) => (m.role === "system" ? { ...m, content: m.content.split("\n").filter((l) => l !== line).join("\n") } : m));
}

/**
 * r7 follow-ups (M8, round-6 C4; 2026-10-06): rule lines shortened or merged since the recordings were made. They are
 * compared by their first words only (both sides), so the dynamic parts that matter stay byte-for-byte: the mix line,
 * the openers named for the park (the "Start each clue" line up to its first "."), the voice, the refill notes, the
 * Park Finds and SPOT sources. The recorded answers are answers to the older wording of these lines (said in the
 * r7-followups report). Lines whose rule did not change are still compared exactly.
 */
const EDITED_RULE_PREFIXES = [
  "- Prefer things that stay put",
  "- Never open with a filler word",
  "- Ask the child to listen",
  "- Write every clue to the child",
  "- A count clue is a task",
  "- A clue that talks to the child never switches",
  "- Wild Finds: the clue must hold a trait",
  "- Plants: write about flowers",
  "- A count clue is allowed ONLY",
  "- Never name the thing",
  "- lookWhere is a plain place",
  "- Each clue is at most",
  "- Some first-try clues used field-guide words",
] as const;

function shapeOfSystemLine(line: string): string | null {
  if (line === kidWordsRule()) return null;
  if (line.startsWith("- Start each clue with a different first word.")) return line.split(". Never start with")[0];
  const edited = EDITED_RULE_PREFIXES.find((p) => line.startsWith(p));
  // The voice-switch rule was merged into the "Write every clue" line: compared as one rule.
  if (edited === "- A clue that talks to the child never switches") return null;
  return edited ?? line;
}

/** Round-6 C4: the water kinds whose fact banks gained sight facts (their recorded sources are the older facts). */
const WATER_FACT_IDS = /^(?:osm-creek|osm-fountain)$/;

const unescapeSource = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * Round-6 C4: the creek and fountain fact sheets each recorded answer was written for, read from the recorded
 * request itself (the first call's POOL). Tests that check a recorded answer item by item give those two items
 * their recorded text (`withRecordedWaterFacts`), so the answer is judged against the sheet the model really saw.
 */
export function recordedWaterFacts(slug: string): Map<string, string> {
  const user = modelRec(slug).request.messages.find((m) => m.role === "user")?.content ?? "";
  const out = new Map<string, string>();
  for (const m of user.matchAll(/<source id="([^"]*)" section="park" kind="[^"]*">([^<]*)<\/source>/g)) {
    if (WATER_FACT_IDS.test(m[1])) out.set(m[1], unescapeSource(m[2]));
  }
  return out;
}

/**
 * The recorded creek / fountain facts of both recorded parks, keyed "<park id>|<kind>" (the facts part of the
 * recorded fact sheet: what follows "(OpenStreetMap)." and any "Mapped name: ..." sentence).
 */
export function recordedParkFacts(): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of Object.values(PARKS)) {
    for (const [id, text] of recordedWaterFacts(p.slug)) {
      const facts = text.replace(/^.*?\(OpenStreetMap\)\.(?: Mapped names?: [^.]*\.)?\s*/, "");
      out.set(`${p.id}|${id.replace(/^osm-/, "").replace(/-/g, "_")}`, facts);
    }
  }
  return out;
}

export function withRecordedWaterFacts<T extends { id: string; sourceText: string }>(items: readonly T[], slug: string): T[] {
  const facts = recordedWaterFacts(slug);
  return items.map((i) => (facts.has(i.id) ? { ...i, sourceText: facts.get(i.id)! } : i));
}

/**
 * Audit R5-C3 (2026-10-06): Wild Finds source text now loses taxonomy and weights (wild.ts `kidSourceText`),
 * so the recorded requests' Wild Finds texts are the pre-R5 ones. This keeps everything else byte-for-byte
 * comparable: the system prompt without the kid-words line, every Park Find and SPOT source exactly, and
 * the Wild Finds sources by id, section and kind (their text blanked on both sides).
 */
export function recordedShape<T extends { role: string; content: string }>(messages: readonly T[]): T[] {
  return withoutKidWordsRule(messages).map((m) => {
    if (m.role === "system") {
      const lines = m.content.split("\n").map(shapeOfSystemLine).filter((l): l is string => l !== null);
      return { ...m, content: lines.join("\n") };
    }
    if (m.role !== "user") return m;
    const wildBlank = m.content.replace(/(<source id="inat-[^"]*" section="wild" kind="[^"]*">)[^<]*(<\/source>)/g, "$1$2");
    // Round-6 C4: creek and fountain fact sheets are compared by id, section and kind (their text blanked on both sides).
    return { ...m, content: wildBlank.replace(/(<source id="([^"]*)" section="park" kind="[^"]*">)[^<]*(<\/source>)/g, (all, open: string, id: string, close: string) => (WATER_FACT_IDS.test(id) ? `${open}${close}` : all)) };
  });
}
