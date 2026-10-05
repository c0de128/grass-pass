/**
 * `pnpm eval:record`: record the 20 eval parks LIVE (SPEC 6.4) with the app's own source code.
 * For each case: Overpass park features (the app's 3-endpoint failover), iNaturalist species_counts
 * (1.5 km, last 14 days, research grade) and the taxa summaries the app would ask for.
 *
 * Polite by design: one park at a time, the app's own Overpass/iNat politeness (1 iNat request/s,
 * at most 2 Overpass queries), a pause between parks, and one slow retry when Overpass is busy.
 * Existing fixtures are kept unless EVAL_RECORD_FORCE=1. A park that can't be fetched is written to
 * the recording log as a failure (never filled in).
 */
import "@/lib/zod-config";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { MemoryStore } from "@/lib/cache/store";
import { userAgent, SourceError } from "@/lib/sources/common";
import { parseSpeciesCounts, parseTaxa, speciesCounts, taxaSummaries, windowStart, type SpeciesList } from "@/lib/sources/inat";
import { parkFeatures, parseFeatures, parseParkId, type ParkFeatures } from "@/lib/sources/overpass-features";
import { wildCandidates } from "@/lib/pool/wild";
import {
  EvalFixtureSchema,
  FIXTURE_DIR,
  fixturePath,
  loadCases,
  loadFixture,
  overpassQueryOf,
  recordingFetch,
  summarize,
  TRIM_NOTE,
  trimOverpass,
  trimSpecies,
  trimTaxa,
  type EvalCase,
  type EvalFixture,
  type Exchange,
  type RecordedCall,
} from "./fixture";
import { prettyJson } from "./json";

const PAUSE_BETWEEN_PARKS_MS = 6_000;
const BUSY_RETRY_WAIT_MS = 75_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (s: string) => process.stdout.write(`${s}\n`);

export type RecordOutcome =
  | { case: EvalCase; ok: true; file: string; summary: EvalFixture["_recording"]["summary"]; tries: number; overpassEndpoint: string; overpassMs: number; failedOverpassAttempts: number }
  | { case: EvalCase; ok: false; reason: string; tries: number }
  | { case: EvalCase; ok: true; skipped: true; file: string; fetchedAt: string; summary: EvalFixture["_recording"]["summary"] };

function okJson(c: RecordedCall): unknown {
  if (c.status !== 200 || c.text === null) return null;
  try {
    return JSON.parse(c.text) as unknown;
  } catch {
    return null;
  }
}

function attemptOf(c: RecordedCall) {
  return { url: c.url, status: c.status, error: c.error, latencyMs: c.latencyMs, at: c.at };
}

/** Turn the recorded calls into fixture exchanges (trimmed), checking that the app parses both the same. */
export function buildExchanges(calls: RecordedCall[], parkId: string): Exchange[] {
  const ref = parseParkId(parkId);
  if (!ref) throw new Error("bad park id");
  const out: Exchange[] = [];
  const overpass = calls.filter((c) => c.method === "POST");
  const okOverpass = overpass.find((c) => {
    const j = okJson(c) as { elements?: unknown; remark?: unknown } | null;
    return j !== null && Array.isArray(j.elements) && !(typeof j.remark === "string" && /error|timed? ?out|out of memory|too busy/i.test(j.remark));
  });
  if (okOverpass) {
    const raw = okJson(okOverpass);
    const trimmed = trimOverpass(raw, parkId);
    if (!isDeepStrictEqual(parseFeatures(raw, ref), parseFeatures(trimmed, ref))) throw new Error("trimmed Overpass answer parses differently");
    out.push({
      source: "overpass",
      what: "features",
      method: "POST",
      url: okOverpass.url,
      query: overpassQueryOf(okOverpass.body) ?? undefined,
      status: 200,
      contentType: okOverpass.contentType,
      fetchedAt: okOverpass.at,
      latencyMs: okOverpass.latencyMs,
      failedAttempts: overpass.filter((c) => c !== okOverpass).map(attemptOf),
      body: trimmed,
    });
  }
  for (const c of calls.filter((x) => x.method === "GET")) {
    const raw = okJson(c);
    if (raw === null) continue;
    const isSpecies = c.url.includes("/observations/species_counts");
    const trimmed = isSpecies ? trimSpecies(raw) : trimTaxa(raw);
    const same = isSpecies
      ? isDeepStrictEqual(parseSpeciesCounts(raw), parseSpeciesCounts(trimmed))
      : isDeepStrictEqual(parseTaxa(raw), parseTaxa(trimmed));
    if (!same) throw new Error(`trimmed iNaturalist answer parses differently: ${c.url}`);
    out.push({
      source: "inaturalist",
      what: isSpecies ? "species_counts" : "taxa",
      method: "GET",
      url: c.url,
      status: 200,
      contentType: c.contentType,
      fetchedAt: c.at,
      latencyMs: c.latencyMs,
      failedAttempts: [],
      body: trimmed,
    });
  }
  return out;
}

async function recordOnce(c: EvalCase): Promise<{ fx: EvalFixture; endpoint: string; overpassMs: number; failed: number }> {
  const ref = parseParkId(c.parkId);
  if (!ref) throw new Error(`bad park id ${c.parkId}`);
  const rec = recordingFetch();
  const env = {};
  const startedAt = Date.now();
  const features: ParkFeatures | null = await parkFeatures(ref, { store: new MemoryStore(), fetchImpl: rec.fetch, env });
  if (!features) throw new Error(`${c.parkId} is not a named leisure=park|nature_reserve with a centre on OpenStreetMap`);
  const since = windowStart(Date.now());
  const store = new MemoryStore();
  const species: SpeciesList = await speciesCounts({ lat: features.park.lat, lng: features.park.lng }, since, { store, fetchImpl: rec.fetch, env });
  const ids = wildCandidates(species).candidates.map((s) => s.taxonId);
  if (ids.length > 0) await taxaSummaries(ids, { store, fetchImpl: rec.fetch, env });

  const exchanges = buildExchanges(rec.calls, c.parkId);
  const ov = exchanges.find((e) => e.source === "overpass");
  if (!ov) throw new Error("no usable Overpass answer was recorded");
  const fx: EvalFixture = {
    _recording: {
      what: `Eval case ${c.n}: ${c.name} (${c.city}), ${c.parkId}. Live Overpass park features + iNaturalist species (1.5 km, since ${since}, research grade) + taxa summaries, requested by the app's own code (src/lib/sources/*).`,
      live: true,
      case: c.n,
      parkId: c.parkId,
      recordedBy: "pnpm eval:record (evals/record.ts) running src/lib/sources/{overpass-features,inat}.ts against the live APIs",
      userAgent: userAgent({}),
      fetchedAt: new Date(startedAt).toISOString(),
      fetchedAtMs: startedAt,
      trimmed: TRIM_NOTE,
      summary: summarize(features, species, ids.length),
    },
    exchanges,
  };
  EvalFixtureSchema.parse(fx);
  return { fx, endpoint: new URL(ov.url).host, overpassMs: ov.latencyMs, failed: ov.failedAttempts.length };
}

function describe(err: unknown): string {
  if (err instanceof SourceError) {
    const cause = err.cause instanceof Error ? `: ${err.cause.name} ${err.cause.message}${err.cause.cause instanceof Error ? ` (${err.cause.cause.message})` : ""}` : "";
    return `${err.source} ${err.code}${err.status ? ` (HTTP ${err.status})` : ""}${cause}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export async function recordAll(opts: { only?: number[]; force?: boolean } = {}): Promise<RecordOutcome[]> {
  const { cases } = loadCases();
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const outcomes: RecordOutcome[] = [];
  let first = true;
  for (const c of cases) {
    if (opts.only && !opts.only.includes(c.n)) continue;
    const file = fixturePath(c.slug);
    if (!opts.force && existsSync(file)) {
      const kept = loadFixture(c.slug);
      outcomes.push({ case: c, ok: true, skipped: true, file, fetchedAt: kept._recording.fetchedAt, summary: kept._recording.summary });
      say(`case ${c.n} ${c.name}: kept existing fixture`);
      continue;
    }
    if (!first) await sleep(PAUSE_BETWEEN_PARKS_MS);
    first = false;
    let tries = 0;
    let last: unknown = null;
    for (; tries < 2; ) {
      tries++;
      try {
        const r = await recordOnce(c);
        writeFileSync(file, prettyJson(r.fx));
        outcomes.push({ case: c, ok: true, file, summary: r.fx._recording.summary, tries, overpassEndpoint: r.endpoint, overpassMs: r.overpassMs, failedOverpassAttempts: r.failed });
        const s = r.fx._recording.summary;
        say(`case ${c.n} ${c.name}: ok via ${r.endpoint} (${r.overpassMs} ms), ${s.featureKinds} feature kinds, ${s.totalSpecies} species`);
        last = null;
        break;
      } catch (err) {
        last = err;
        say(`case ${c.n} ${c.name}: try ${tries} failed: ${describe(err)}`);
        const busy = err instanceof SourceError;
        if (tries < 2 && busy) await sleep(BUSY_RETRY_WAIT_MS);
        else break;
      }
    }
    if (last !== null) outcomes.push({ case: c, ok: false, reason: describe(last), tries });
  }
  writeFileSync(path.join(FIXTURE_DIR, "RECORDING-LOG.md"), recordingLog(outcomes));
  return outcomes;
}

export function recordingLog(outcomes: RecordOutcome[]): string {
  const rows = outcomes.map((o) => {
    if (!o.ok) return `| ${o.case.n} | ${o.case.name} | \`${o.case.parkId}\` | FAILED after ${o.tries} tries: ${o.reason} | | |`;
    if ("skipped" in o) return `| ${o.case.n} | ${o.case.name} | \`${o.case.parkId}\` | ok, kept the recording from ${o.fetchedAt} | ${o.summary.featureKinds} kinds, ${o.summary.trees} trees | ${o.summary.totalSpecies} species / ${o.summary.totalObservations} obs |`;
    const s = o.summary;
    return `| ${o.case.n} | ${o.case.name} | \`${o.case.parkId}\` | ok, ${o.overpassEndpoint} ${(o.overpassMs / 1000).toFixed(1)} s${o.failedOverpassAttempts ? `, after ${o.failedOverpassAttempts} failed mirror tries` : ""} | ${s.featureKinds} kinds, ${s.trees} trees | ${s.totalSpecies} species / ${s.totalObservations} obs |`;
  });
  return [
    "# Eval fixture recording log",
    "",
    `Last run: ${new Date().toISOString()} by \`pnpm eval:record\`. Every fixture holds the exact fetch time of each answer.`,
    "",
    "| # | Park | OSM id | Result | OSM | iNaturalist (1.5 km, 14 days) |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
