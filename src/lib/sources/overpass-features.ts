/**
 * What is mapped inside one park, from OpenStreetMap via Overpass (SPEC F3, ADR 0002 D2).
 * One fixed query per park, keyed by its OSM id (never a free bbox from a user):
 *   - the park object itself (name + centre; also proves the id really is a named park);
 *   - features inside its area (ways/relations) or within 150 m (a park mapped as a single node):
 *     pitches by sport, playgrounds and their equipment, shelters, benches, fountains, water, creeks,
 *     bridges, artwork, and so on. Trees are only counted.
 * Counts are made by code. Names from OSM are untrusted text: trimmed, length-capped, and later
 * escaped inside <source> tags in the prompt.
 */
import "server-only";
import "@/lib/zod-config";
import { z } from "zod";
import { isValidLatLng } from "@/lib/geo";
import { runOverpass, OVERPASS_QUERY_TIMEOUT_SEC, type OverpassDeps } from "./overpass";

export type OsmType = "node" | "way" | "relation";
export type ParkRef = { type: OsmType; id: number };

const PARK_ID_RE = /^(node|way|relation)\/(\d{1,15})$/;

/** "way/306191453" -> { type: "way", id: 306191453 }; anything else -> null. */
export function parseParkId(s: string): ParkRef | null {
  const m = PARK_ID_RE.exec(s);
  if (!m) return null;
  const id = Number(m[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { type: m[1] as OsmType, id };
}

export const parkIdOf = (r: ParkRef) => `${r.type}/${r.id}`;

/** Radius used when a park is mapped as one point (no area to look inside). */
export const NODE_PARK_RADIUS_M = 150;

const SELECTORS = [
  `nwr(SCOPE)["leisure"~"^(pitch|playground|dog_park|fitness_station|picnic_table|swimming_pool|track|garden|bleachers|splash_pad)$"]`,
  `nwr(SCOPE)["amenity"~"^(shelter|drinking_water|bench|fountain|bbq)$"]`,
  `nwr(SCOPE)["tourism"~"^(artwork|information|viewpoint|picnic_site)$"]`,
  `nwr(SCOPE)["natural"~"^(water|tree)$"]`,
  `way(SCOPE)["waterway"~"^(stream|river|canal)$"]`,
  `nwr(SCOPE)["man_made"~"^(bridge|tower|observation_tower|flagpole)$"]`,
  `way(SCOPE)["highway"]["bridge"="yes"]`,
  `nwr(SCOPE)["playground"]`,
  `nwr(SCOPE)["historic"]`,
];

/**
 * The tag filter every park query puts on the requested element itself (SEC-1-01): an id that is
 * not a NAMED park or nature reserve selects nothing, so the area/around steps that follow run on an
 * empty set and Overpass does no heavy work for it.
 */
export const PARK_FILTER = `["leisure"~"^(park|nature_reserve)$"]["name"]`;

/** `way(123)["leisure"~...]["name"]->.p;` for one park ref (numeric id only, validated). */
export function parkSelector(ref: ParkRef): string {
  if (!Number.isSafeInteger(ref.id) || ref.id <= 0) throw new RangeError("bad id");
  const sel = ref.type === "node" ? "node" : ref.type === "way" ? "way" : "rel";
  return `${sel}(${ref.id})${PARK_FILTER}->.p;`;
}

/** The fixed Overpass QL for one park. Only the numeric id comes from the request (validated). */
export function featuresQuery(ref: ParkRef): string {
  const head = `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_SEC}];`;
  if (ref.type === "node") {
    const body = SELECTORS.map((s) => s.replace("SCOPE", `around.p:${NODE_PARK_RADIUS_M}`)).join(";");
    return `${head}${parkSelector(ref)}.p out;(${body};);out tags center qt;`;
  }
  const body = SELECTORS.map((s) => s.replace("SCOPE", "area.a")).join(";");
  return `${head}${parkSelector(ref)}.p out tags center;.p map_to_area->.a;(${body};);out tags center qt;`;
}

// ---------- feature kinds ----------

export type FeatureKindInfo = {
  /** Singular label for the parent's answer key, e.g. "basketball court". */
  label: string;
  plural: string;
  /** A short, fixed, code-written description the model may quote (kid-level). */
  describe: string;
  /** Words a clue must not contain (it would give the answer away). */
  nameWords: string[];
};

/** Every kind a Park Find can be. Restrooms, paths and parking are not finds. */
export const FEATURE_KINDS = {
  basketball: { label: "basketball court", plural: "basketball courts", describe: "A basketball court is a flat hard court with a hoop on a tall pole at each end.", nameWords: ["basketball"] },
  tennis: { label: "tennis court", plural: "tennis courts", describe: "A tennis court is a flat court with a low net across the middle and a tall fence around it.", nameWords: ["tennis"] },
  pickleball: { label: "pickleball court", plural: "pickleball courts", describe: "A pickleball court is a small flat court with a low net across the middle.", nameWords: ["pickleball"] },
  volleyball: { label: "volleyball court", plural: "volleyball courts", describe: "A volleyball court has a high net across the middle; some are on sand.", nameWords: ["volleyball"] },
  soccer: { label: "soccer field", plural: "soccer fields", describe: "A soccer field is a big grass field with a goal with a net at each end.", nameWords: ["soccer"] },
  baseball: { label: "baseball field", plural: "baseball fields", describe: "A baseball field has a dirt diamond with bases and a tall fence behind home plate.", nameWords: ["baseball", "softball"] },
  football: { label: "football field", plural: "football fields", describe: "A football field is a long grass field with goal posts shaped like a tall letter Y or H.", nameWords: ["football"] },
  sports_field: { label: "sports field", plural: "sports fields", describe: "A sports field is an open marked area where people play games.", nameWords: [] },
  playground: { label: "playground", plural: "playgrounds", describe: "A playground is a place with things to climb, slide and swing on.", nameWords: ["playground"] },
  slide: { label: "slide", plural: "slides", describe: "A slide is a smooth slope you sit on and zoom down.", nameWords: ["slide", "sliding"] },
  swing: { label: "swing", plural: "swings", describe: "A swing is a seat that hangs from chains or ropes and moves back and forth.", nameWords: ["swing", "swings", "swinging"] },
  climbing: { label: "climbing frame", plural: "climbing frames", describe: "A climbing frame has bars, ropes or holds to climb up and across.", nameWords: ["climbing frame", "jungle gym"] },
  sandbox: { label: "sandbox", plural: "sandboxes", describe: "A sandbox is a low box filled with sand for digging.", nameWords: ["sandbox", "sandpit"] },
  seesaw: { label: "seesaw", plural: "seesaws", describe: "A seesaw is a long board that goes up and down with a rider at each end.", nameWords: ["seesaw", "see-saw", "teeter"] },
  spring_rider: { label: "spring rider", plural: "spring riders", describe: "A spring rider is a little seat on a big metal spring that rocks back and forth.", nameWords: ["spring rider"] },
  merry_go_round: { label: "merry-go-round", plural: "merry-go-rounds", describe: "A merry-go-round is a round platform that spins when you push it.", nameWords: ["merry-go-round", "roundabout", "carousel"] },
  zip_line: { label: "zip line", plural: "zip lines", describe: "A zip line has a seat or handle that rolls along a cable.", nameWords: ["zip line", "zipline", "zipwire"] },
  splash_pad: { label: "splash pad", plural: "splash pads", describe: "A splash pad is a play area with water that sprays up from the ground.", nameWords: ["splash pad"] },
  shelter: { label: "picnic shelter", plural: "picnic shelters", describe: "A picnic shelter has a roof on posts and tables underneath where people eat lunch.", nameWords: ["shelter", "pavilion", "gazebo"] },
  picnic_table: { label: "picnic table", plural: "picnic tables", describe: "A picnic table is an outdoor table with benches attached.", nameWords: ["picnic table"] },
  bench: { label: "bench", plural: "benches", describe: "A bench is a long outdoor seat for resting.", nameWords: ["bench"] },
  fountain: { label: "fountain", plural: "fountains", describe: "A fountain sprays or pours water into a pool or basin.", nameWords: ["fountain"] },
  drinking_water: { label: "drinking fountain", plural: "drinking fountains", describe: "A drinking fountain gives you a sip of water when you press a button.", nameWords: ["drinking fountain", "water fountain"] },
  bbq: { label: "barbecue grill", plural: "barbecue grills", describe: "A park grill is a metal box on a post where people cook food.", nameWords: ["grill", "barbecue", "bbq"] },
  dog_park: { label: "dog park", plural: "dog parks", describe: "A dog park is a fenced area where dogs can run off the leash.", nameWords: ["dog park"] },
  fitness: { label: "exercise station", plural: "exercise stations", describe: "An exercise station has bars or machines for stretching and working out.", nameWords: ["exercise station", "fitness"] },
  pool: { label: "swimming pool", plural: "swimming pools", describe: "A swimming pool is a big tank of water for swimming.", nameWords: ["swimming pool"] },
  track: { label: "running track", plural: "running tracks", describe: "A running track is an oval path with lanes for running.", nameWords: ["running track"] },
  garden: { label: "garden", plural: "gardens", describe: "A garden is a planted area with flowers or plants that people look after.", nameWords: ["garden"] },
  bleachers: { label: "set of bleachers", plural: "sets of bleachers", describe: "Bleachers are rows of benches stepped up high so people can watch a game.", nameWords: ["bleachers"] },
  artwork: { label: "piece of public art", plural: "pieces of public art", describe: "Public art is a sculpture, statue or mural made for everyone to see.", nameWords: ["sculpture", "statue", "artwork", "mural"] },
  info_board: { label: "information sign", plural: "information signs", describe: "An information sign is a board with words or a map about the park.", nameWords: ["information sign", "information board"] },
  viewpoint: { label: "viewpoint", plural: "viewpoints", describe: "A viewpoint is a spot with a good view across the park.", nameWords: ["viewpoint"] },
  water: { label: "pond or lake", plural: "ponds or lakes", describe: "A pond is still water where you may see ducks, turtles or fish.", nameWords: ["pond", "lake"] },
  creek: { label: "creek or stream", plural: "creeks or streams", describe: "A creek is a narrow line of moving water with a muddy or rocky bank on each side.", nameWords: ["creek", "stream", "river", "brook"] },
  bridge: { label: "bridge", plural: "bridges", describe: "A bridge lets a path cross over water or a dip in the ground.", nameWords: ["bridge"] },
  tower: { label: "tower", plural: "towers", describe: "A tower is a tall, narrow structure you can see from far away.", nameWords: ["tower"] },
  flagpole: { label: "flagpole", plural: "flagpoles", describe: "A flagpole is a very tall pole that holds a flag up high.", nameWords: ["flagpole"] },
  historic: { label: "historic marker or site", plural: "historic markers or sites", describe: "A historic marker is a sign or object that tells something from long ago.", nameWords: ["historic", "marker", "monument", "memorial"] },
} as const satisfies Record<string, FeatureKindInfo>;

export type FeatureKind = keyof typeof FEATURE_KINDS;
export const FEATURE_KIND_IDS = Object.keys(FEATURE_KINDS) as FeatureKind[];

const SPORT_KIND: Record<string, FeatureKind> = {
  basketball: "basketball",
  tennis: "tennis",
  pickleball: "pickleball",
  volleyball: "volleyball",
  beachvolleyball: "volleyball",
  soccer: "soccer",
  baseball: "baseball",
  softball: "baseball",
  american_football: "football",
};

const PLAYGROUND_KIND: Record<string, FeatureKind> = {
  slide: "slide",
  swing: "swing",
  basketswing: "swing",
  climbingframe: "climbing",
  climbing_frame: "climbing",
  sandpit: "sandbox",
  seesaw: "seesaw",
  springy: "spring_rider",
  roundabout: "merry_go_round",
  zipwire: "zip_line",
};

type Tags = Record<string, string>;

/** Which find a mapped object is, or null when it isn't one. `"tree"` is counted separately. */
export function classify(tags: Tags): FeatureKind | "tree" | null {
  const leisure = tags.leisure;
  if (leisure === "pitch") {
    const sport = (tags.sport ?? "").split(";")[0].trim();
    return SPORT_KIND[sport] ?? "sports_field";
  }
  if (tags.playground && leisure !== "playground") return PLAYGROUND_KIND[tags.playground] ?? null;
  switch (leisure) {
    case "playground":
      return "playground";
    case "dog_park":
      return "dog_park";
    case "fitness_station":
      return "fitness";
    case "picnic_table":
      return "picnic_table";
    case "swimming_pool":
      return "pool";
    case "track":
      return "track";
    case "garden":
      return "garden";
    case "bleachers":
      return "bleachers";
    case "splash_pad":
      return "splash_pad";
  }
  switch (tags.amenity) {
    case "shelter":
      return "shelter";
    case "bench":
      return "bench";
    case "fountain":
      return "fountain";
    case "drinking_water":
      return "drinking_water";
    case "bbq":
      return "bbq";
  }
  switch (tags.tourism) {
    case "artwork":
      return "artwork";
    case "information":
      return tags.information === "board" || tags.information === "map" ? "info_board" : null;
    case "viewpoint":
      return "viewpoint";
    case "picnic_site":
      return "picnic_table";
  }
  if (tags.natural === "water") return "water";
  if (tags.natural === "tree") return "tree";
  if (tags.waterway === "stream" || tags.waterway === "river" || tags.waterway === "canal") return "creek";
  if (tags.man_made === "bridge" || (tags.bridge === "yes" && tags.highway)) return "bridge";
  if (tags.man_made === "tower" || tags.man_made === "observation_tower") return "tower";
  if (tags.man_made === "flagpole") return "flagpole";
  if (tags.historic) return "historic";
  return null;
}

// ---------- parsing ----------

const Element = z.object({
  type: z.enum(["node", "way", "relation"]),
  id: z.number().int().positive(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

/** Cleaned OSM text: no control chars or angle brackets, single spaces, at most `max` chars. */
export function cleanOsmText(s: string, max = 80): string {
  return s
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>{}\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

export const FeatureCountSchema = z.object({
  count: z.number().int().min(1),
  /** Up to 3 distinct OSM names of objects of this kind (e.g. "Rowlett Creek"). */
  names: z.array(z.string().max(80)).max(3),
});

export const ParkFeaturesSchema = z.object({
  park: z.object({
    id: z.string(),
    name: z.string().min(1).max(120),
    kind: z.enum(["park", "nature_reserve"]),
    lat: z.number(),
    lng: z.number(),
  }),
  features: z.partialRecord(z.enum(FEATURE_KIND_IDS as [FeatureKind, ...FeatureKind[]]), FeatureCountSchema),
  trees: z.number().int().min(0),
});
export type ParkFeatures = z.infer<typeof ParkFeaturesSchema>;

/**
 * Turn the Overpass answer into a park + feature counts. Returns null when the id is not a named
 * `leisure=park|nature_reserve` with a usable centre (the caller says "not a park we can read").
 */
export function parseFeatures(json: unknown, ref: ParkRef): ParkFeatures | null {
  const elements = z.object({ elements: z.array(z.unknown()) }).parse(json).elements;
  let park: ParkFeatures["park"] | null = null;
  const features: ParkFeatures["features"] = {};
  const seen = new Set<string>();
  let trees = 0;
  for (const raw of elements) {
    const e = Element.safeParse(raw);
    if (!e.success) continue;
    const el = e.data;
    const tags = el.tags ?? {};
    if (el.type === ref.type && el.id === ref.id) {
      const name = cleanOsmText(tags.name ?? "", 120);
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      const kind = tags.leisure === "nature_reserve" ? "nature_reserve" : tags.leisure === "park" ? "park" : null;
      if (name && kind && lat !== undefined && lng !== undefined && isValidLatLng({ lat, lng })) {
        park = { id: parkIdOf(ref), name, kind, lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
      }
      continue;
    }
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = classify(tags);
    if (!kind) continue;
    if (kind === "tree") {
      trees++;
      continue;
    }
    const entry = (features[kind] ??= { count: 0, names: [] });
    entry.count++;
    const name = tags.name ? cleanOsmText(tags.name) : "";
    if (name && entry.names.length < 3 && !entry.names.includes(name)) entry.names.push(name);
  }
  if (!park) return null;
  // Note: waterways are often split into several mapped pieces, so the pool never states a creek count.
  return { park, features, trees };
}

/** Fetch and parse. Throws SourceError from runOverpass; returns null when the id is not a readable park. */
export async function parkFeatures(ref: ParkRef, deps: OverpassDeps): Promise<ParkFeatures | null> {
  const { json } = await runOverpass(featuresQuery(ref), deps);
  return parseFeatures(json, ref);
}
