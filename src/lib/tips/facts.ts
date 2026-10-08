/**
 * Trip tips, step 1: the REAL inputs, as short numbered facts. Every trip tip (the model's or the code's) must point at
 * one of these, and its "why" line is that fact's text, written here by code (never by the model).
 *
 * Inputs (all already gathered for the pass; nothing here calls a service):
 * - the day's forecast (Open-Meteo, src/lib/sources/open-meteo.ts) for the day the weather card shows (today, or
 *   tomorrow from 6 PM / after sunset: src/lib/weather/summary.ts `pickDay`), and official alerts (weather.gov);
 * - the park's OpenStreetMap features (counts and a few names) and, when the Find This Spot outline was ready, its
 *   restrooms and foot paths;
 * - iNaturalist sightings within 1.5 km in the last 14 days, only the few kinds a family should plan for (poison ivy,
 *   ticks, fire ants, mosquitoes, venomous snakes, stinging insects, stinging plants or caterpillars).
 * A missing input is simply left out (no fact = no tip about it). Pure: the time is passed in.
 */
import { blockedBy } from "@/lib/safety/danger-taxa";
import { hasUrlOrMarkup } from "@/lib/safety/contact";
import { codeInfo, isFairCode, isFogCode, isWinterCode } from "@/lib/weather/codes";
import { clockLabel, outingHours, outingStats, pickDay } from "@/lib/weather/summary";
import type { Forecast, WeatherAlert } from "@/lib/weather/types";
import type { AgeBand } from "@/lib/pass/constants";

/** What a fact is about: the rules list and the grounding check (check.ts) read these. */
export type FactTag =
  // weather
  | "clear"
  | "hot"
  | "warm"
  | "mild"
  | "chilly"
  | "cold"
  | "layers"
  | "cool_morning"
  | "afternoon_heat"
  | "rain"
  | "dry"
  | "storm"
  | "uv"
  | "uv_high"
  | "wind"
  | "sunset"
  | "fog"
  | "winter"
  | "alert"
  // park map
  | "drinking_water"
  | "no_drinking_water"
  | "shelter"
  | "shade_trees"
  | "creek"
  | "water"
  | "playground"
  | "splash_pad"
  | "picnic"
  | "bench"
  | "dogs"
  | "bridge"
  | "nature"
  | "restroom"
  | "no_restroom"
  | "paths"
  // sightings
  | "poison_ivy"
  | "tick"
  | "fire_ant"
  | "mosquito"
  | "chigger"
  | "snake"
  | "wasp"
  | "stinging_plant"
  | "caterpillar"
  // the pass itself
  | "pass";

export type FactGroup = "weather" | "park" | "wildlife" | "pass";

export type TipFact = {
  /** Stable id the model cites ("w-day", "p-creek", "i-tick"). */
  id: string;
  group: FactGroup;
  /** Short, code-written; shown on the page as the tip's "why". */
  text: string;
  tags: FactTag[];
};

export type TipFacts = {
  parkName: string;
  band: AgeBand;
  /** The park-local day the forecast is for, or the pass day without a forecast. */
  forDate: string;
  which: "today" | "tomorrow" | null;
  forecast: boolean;
  facts: TipFact[];
};

/** One species from the iNaturalist species list (the fields this file reads). */
export type SightedSpecies = { taxonId: number; ancestorIds: readonly number[]; name: string; commonName: string | null; count: number };

/** What the park map says (src/lib/sources/overpass-features.ts ParkFeatures, the fields this file reads). */
export type MapFeatures = {
  kind: "park" | "nature_reserve";
  features: Partial<Record<string, { count: number; names: readonly string[] }>>;
  trees: number;
};

/** Restrooms and foot paths, from the Find This Spot outline (null when it wasn't ready). */
export type MapExtras = { toilets: number; paths: number } | null;

export type TipFactsInput = {
  parkName: string;
  band: AgeBand;
  /** The pass's own (Chicago) day. */
  passDay: string;
  nowMs: number;
  forecast: Forecast | null;
  alerts: readonly WeatherAlert[] | null;
  map: MapFeatures;
  extras: MapExtras;
  /** iNaturalist species near the park (null: iNaturalist didn't answer). */
  species: readonly SightedSpecies[] | null;
  /** First day of the iNaturalist window ("2026-09-24"). */
  since: string | null;
  /** How many finds the pass asks for. */
  finds: number;
};

const FACT_MAX = 110;

/** iNaturalist taxa worth a trip tip, by the blocked group (src/lib/safety/danger-taxa.ts) or the family id. */
const BLOCKED_TAG: Record<number, FactTag> = {
  51079: "poison_ivy", // Toxicodendron
  51672: "tick", // Ixodida
  67597: "fire_ant", // Solenopsis
  69114: "fire_ant", // Pogonomyrmex (harvester ants: stinging ants, same advice)
  30668: "snake", // Agkistrodon
  30692: "snake", // Crotalus
  30979: "snake", // Sistrurus
  30493: "snake", // Micrurus
  52747: "wasp", // Vespidae
  48742: "wasp", // Sphecidae
  51955: "wasp", // Crabronidae
  1269342: "wasp", // Pompiloidea
  51967: "wasp", // Scoliidae
  51886: "stinging_plant", // Urtica
  133074: "stinging_plant", // Cnidoscolus texanus
  72405: "stinging_plant", // Tragia
  84185: "caterpillar", // Megalopyge opercularis
  84186: "caterpillar", // Megalopygidae
  84165: "caterpillar", // Limacodidae
  82286: "caterpillar", // Automeris
  82145: "caterpillar", // Hemileuca
};
/** Not blocked from passes, but worth a bug-spray tip. Ids resolved live on iNaturalist 2026-10-08 (`/v1/taxa?q=<family>&rank=family`). */
const FAMILY_TAG: Record<number, FactTag> = {
  52134: "mosquito", // family Culicidae, "Mosquitoes"
  245044: "chigger", // family Trombiculidae, "Chiggers"
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09-24" -> "Sep 24". */
export function monthDay(isoDay: string): string {
  const [, m, d] = isoDay.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clip = (s: string) => (s.length <= FACT_MAX ? s : `${s.slice(0, FACT_MAX - 1).trimEnd()}…`);
const times = (n: number) => (n === 1 ? "once" : `${n} times`);

/** The tag a sighted species earns (null for every other species). */
export function sightingTag(s: Pick<SightedSpecies, "taxonId" | "ancestorIds">): FactTag | null {
  for (const id of [s.taxonId, ...s.ancestorIds]) {
    const fam = FAMILY_TAG[id];
    if (fam) return fam;
  }
  const b = blockedBy({ taxonId: s.taxonId, ancestorIds: s.ancestorIds });
  return b ? (BLOCKED_TAG[b.id] ?? null) : null;
}

function weatherFacts(input: TipFactsInput): { facts: TipFact[]; forDate: string | null; which: "today" | "tomorrow" | null } {
  if (!input.forecast) return { facts: [], forDate: null, which: null };
  const pick = pickDay(input.forecast, input.nowMs);
  if (!pick) return { facts: [], forDate: null, which: null };
  const { day } = pick;
  const s = outingStats(pick);
  const high = Math.round(day.highF);
  const low = Math.round(day.lowF);
  const facts: TipFact[] = [];

  const dayTags: FactTag[] = [];
  if (isFairCode(day.code)) dayTags.push("clear");
  if (high >= 90) dayTags.push("hot");
  else if (high >= 80) dayTags.push("warm");
  else if (high < 45) dayTags.push("cold");
  else if (high <= 60) dayTags.push("chilly");
  else dayTags.push("mild");
  if (low <= 55 && high - low >= 15) dayTags.push("layers");
  if (s.fog || isFogCode(day.code)) dayTags.push("fog");
  if (s.winter || isWinterCode(day.code)) dayTags.push("winter");
  facts.push({ id: "w-day", group: "weather", text: `${cap(codeInfo(day.code).words)}, high ${high}°F, low ${low}°F`, tags: dayTags });

  // Morning vs. afternoon, from the hours you'd be out.
  const hours = outingHours(pick).filter((h) => h.tempF !== null) as { time: string; tempF: number }[];
  if (hours.length >= 3) {
    const first = hours[0];
    const peak = hours.reduce((a, h) => (h.tempF > a.tempF ? h : a), first);
    if (peak.time !== first.time && Math.round(peak.tempF) - Math.round(first.tempF) >= 5) {
      const tags: FactTag[] = [];
      if (Math.round(peak.tempF) >= 85) tags.push("afternoon_heat");
      if (Math.round(peak.tempF) - Math.round(first.tempF) >= 10) tags.push("cool_morning");
      facts.push({
        id: "w-hours",
        group: "weather",
        text: `About ${Math.round(first.tempF)}°F at ${clockLabel(first.time)}, ${Math.round(peak.tempF)}°F by ${clockLabel(peak.time)}`,
        tags,
      });
    }
  }

  if (s.firstStorm !== null) {
    facts.push({ id: "w-storm", group: "weather", text: s.firstStorm ? `Thunderstorms forecast from about ${clockLabel(s.firstStorm)}` : "Thunderstorms forecast", tags: ["storm", "rain"] });
  } else if (s.stormLater) {
    facts.push({ id: "w-storm", group: "weather", text: `Storms possible after ${clockLabel(s.stormLater)}`, tags: ["storm"] });
  }
  if (s.rainPct !== null) {
    if (s.rainPct >= 30) {
      const from = s.firstRainPossible;
      facts.push({ id: "w-rain", group: "weather", text: from ? `Rain chance up to ${s.rainPct}%, from about ${clockLabel(from)}` : `Rain chance up to ${s.rainPct}%`, tags: ["rain"] });
    } else {
      facts.push({ id: "w-rain", group: "weather", text: `Rain chance only ${s.rainPct}% while you'd be out`, tags: ["dry"] });
    }
  }
  if (day.uv !== null && day.uv >= 3) {
    const uv = Math.round(day.uv);
    facts.push({ id: "w-uv", group: "weather", text: `UV index up to ${uv}${uv >= 8 ? " (very high)" : uv >= 6 ? " (high)" : " (moderate)"}`, tags: uv >= 6 ? ["uv", "uv_high"] : ["uv"] });
  }
  const gust = day.gustMph === null ? null : Math.round(day.gustMph);
  if (gust !== null && gust >= 20) {
    facts.push({ id: "w-wind", group: "weather", text: `Wind gusts up to ${gust} mph`, tags: ["wind"] });
  }
  if (day.sunset) facts.push({ id: "w-sunset", group: "weather", text: `Sunset at ${clockLabel(day.sunset)}`, tags: ["sunset"] });

  // Official alerts still in force (weather.gov). Only the event's name: the card links to the full alert.
  const active = (input.alerts ?? []).filter((a) => {
    const end = a.ends ?? a.expires;
    return end === null || Date.parse(end) > input.nowMs;
  });
  active.slice(0, 2).forEach((a, i) => {
    if (hasUrlOrMarkup(a.event)) return;
    facts.push({ id: `w-alert-${i + 1}`, group: "weather", text: clip(`Official alert: ${a.event} (weather.gov)`), tags: ["alert"] });
  });
  return { facts, forDate: day.date, which: pick.which };
}

const SAFE_NAME = (n: string) => n.length > 0 && n.length <= 60 && !hasUrlOrMarkup(n);
const named = (names: readonly string[] | undefined) => {
  const ok = (names ?? []).filter(SAFE_NAME).slice(0, 2);
  return ok.length > 0 ? `: ${ok.join(", ")}` : "";
};

function parkFacts(input: TipFactsInput): TipFact[] {
  const f = input.map.features;
  const out: TipFact[] = [];
  const count = (k: string) => f[k]?.count ?? 0;
  const add = (id: string, text: string, tags: FactTag[]) => out.push({ id, group: "park", text: clip(text), tags });
  const n = (k: string, one: string, many: string) => (count(k) === 1 ? `1 ${one}` : `${count(k)} ${many}`);

  if (count("drinking_water") > 0) add("p-drinking-water", `${n("drinking_water", "drinking fountain", "drinking fountains")} on the park map`, ["drinking_water"]);
  else add("p-no-drinking-water", "No drinking fountain on the park map", ["no_drinking_water"]);
  if (input.extras) {
    if (input.extras.toilets > 0) add("p-restroom", `${input.extras.toilets === 1 ? "1 restroom" : `${input.extras.toilets} restrooms`} on the park map`, ["restroom"]);
    else add("p-no-restroom", "No restroom on the park map", ["no_restroom"]);
    if (input.extras.paths > 0) add("p-paths", `${input.extras.paths} foot paths and trails on the park map`, ["paths"]);
  }
  if (count("shelter") > 0) add("p-shelter", `${n("shelter", "picnic shelter", "picnic shelters")} for shade${named(f.shelter?.names)}`, ["shelter"]);
  if (input.map.trees >= 10) add("p-trees", `${input.map.trees} trees on the park map`, ["shade_trees"]);
  if (count("creek") > 0) add("p-creek", `A creek or stream${named(f.creek?.names)}`, ["creek"]);
  if (count("water") > 0) add("p-water", `${count("water") === 1 ? "A pond or lake" : `${count("water")} ponds or lakes`}${named(f.water?.names)}`, ["water"]);
  if (count("playground") > 0) add("p-playground", `${n("playground", "playground", "playgrounds")} on the park map`, ["playground"]);
  if (count("splash_pad") > 0) add("p-splash-pad", "A splash pad on the park map", ["splash_pad"]);
  if (count("picnic_table") > 0) add("p-picnic", `${n("picnic_table", "picnic table or site", "picnic tables or sites")} on the park map`, ["picnic"]);
  if (count("bench") > 0) add("p-bench", `${n("bench", "bench", "benches")} on the park map`, ["bench"]);
  if (count("dog_park") > 0) add("p-dogs", "A dog park on the park map", ["dogs"]);
  if (count("bridge") > 0) add("p-bridge", `${n("bridge", "bridge", "bridges")} on the park map`, ["bridge"]);
  if (input.map.kind === "nature_reserve") add("p-nature", "Mapped as a nature preserve", ["nature"]);
  return out;
}

function wildlifeFacts(input: TipFactsInput): TipFact[] {
  if (!input.species || !input.since) return [];
  /** The most-seen species for each tag. */
  const best = new Map<FactTag, { s: SightedSpecies; total: number }>();
  for (const s of input.species) {
    const tag = sightingTag(s);
    if (!tag) continue;
    const prev = best.get(tag);
    if (!prev) best.set(tag, { s, total: s.count });
    else best.set(tag, { s: s.count > prev.s.count ? s : prev.s, total: prev.total + s.count });
  }
  const out: { fact: TipFact; total: number }[] = [];
  for (const [tag, { s, total }] of best) {
    const name = s.commonName && SAFE_NAME(s.commonName) ? s.commonName : SAFE_NAME(s.name) ? s.name : null;
    if (!name) continue;
    out.push({
      total,
      fact: {
        id: `i-${tag.replace(/_/g, "-")}`,
        group: "wildlife",
        text: clip(`${cap(name)} seen ${times(total)} within 1.5 km since ${monthDay(input.since)} (iNaturalist)`),
        tags: [tag],
      },
    });
  }
  // Most sightings first, a fixed order for ties.
  return out
    .sort((a, b) => b.total - a.total || a.fact.id.localeCompare(b.fact.id))
    .slice(0, 4)
    .map((x) => x.fact);
}

/** Every fact for a pass's trip tips (see the file comment). */
export function tipFacts(input: TipFactsInput): TipFacts {
  const w = weatherFacts(input);
  const facts = [
    ...w.facts,
    ...parkFacts(input),
    ...wildlifeFacts(input),
    { id: "x-pass", group: "pass" as const, text: `Your pass has ${input.finds} finds to check off`, tags: ["pass" as const] },
  ];
  return { parkName: input.parkName, band: input.band, forDate: w.forDate ?? input.passDay, which: w.which, forecast: w.forDate !== null, facts };
}

/** Restrooms and foot paths from the Find This Spot outline's mapped elements (OSM tags). */
export function extrasFromElements(elements: readonly { tags: Record<string, string> }[]): { toilets: number; paths: number } {
  let toilets = 0;
  let paths = 0;
  for (const e of elements) {
    if (e.tags.amenity === "toilets") toilets++;
    else if (e.tags.highway && /^(footway|path|cycleway|pedestrian|track|steps|bridleway)$/.test(e.tags.highway)) paths++;
  }
  return { toilets, paths };
}
