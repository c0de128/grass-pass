/**
 * Audit R5-C3 / Q-5-01 (round 5, 2026-10-06): clues that are true and grounded but give a child nothing
 * to look for, because they paste Wikipedia. Measured in run 2026-10-06-6: about 1 in 6 printed Wild
 * Finds. Real examples: "Where is a moth of the Crambidae family?", "Spot a mammal from the family
 * Vespertilionidae.", "Watch for a phrynosomatid reptile ...", "a bug that is shiny black with pale yellow
 * hindtarsomere", "Who has a typical length of 16 cm and a mass of 24-39.5 g?", "Hunt for a lizard native
 * to Texas and Oklahoma.", "a land snail with an operculum", "a lizard that is arboreal".
 *
 * Two levels (validate.ts):
 * - `jargonProblem` -> drop reason `jargon` (always removed): taxonomy (rank words, Latin family names and
 *   their "-id" adjectives, "the most widespread species"), weights and measurement-heavy clues, and words
 *   from a field guide's glossary that no child on a walk knows (pterostigma, tarsomere, inflorescence...).
 * - `triviaProblem` -> drop reason `trivia` (a preference: the first to go when a spare can replace it):
 *   where it lives on the globe ("native to Texas and Oklahoma", "common to Hawaii and Mexico"), field-guide
 *   words a child may not know (operculum, arboreal, aquatic...), and a bare colour ("a bird that is black").
 * Code only reads the clue; it never rewrites it.
 */
import type { AgeBand } from "@/lib/pass/constants";

const norm = (s: string) => s.normalize("NFKC").replace(/[‘’]/g, "'");

/** Rank words used as ranks ("genus", "species"...). "order" only as "the order X" / "in the order". "family" is FAMILY_RANK_RE. */
const RANK_RE = /\b(?:subfamil(?:y|ies)|genus|genera|subspecies|taxon|taxa|taxonomic|binomial|tribe of)\b/i;
/**
 * Round-6 Q-6-04: "in the order" only as a rank ("in the order Lepidoptera"), never "in the order you see them";
 * "species" is a rank word for ages 4-10 and a plain word for 10-13 (a younger-band preference, GLOSSARY_YOUNG).
 */
const ORDER_RANK_RE = /\b(?:in|of|within)\s+the\s+order\s+\p{Lu}\p{Ll}{3,}/u;
const SPECIES_RE = /\bspecies\b/i;

/**
 * r7 follow-ups (eval run 2026-10-06-7): "family" counts only as a rank, never as people. Our own Park Finds
 * facts say "Teams and families use it" and "Families and friends often meet under it" (pool/park.ts), so a
 * grounded clue quoting them was a `jargon` drop. A rank: "in/of/from/to the (pea|sunflower|...) family",
 * "the same family", "a family name", "family Vespertilionidae" (a capitalised group name after it).
 */
const FAMILY_RANK_RE =
  /\b(?:(?:in|of|from|within|to|into)\s+(?:the|a|its|this|that|one)\s+(?:[\p{L}'-]+\s+){0,3}famil(?:y|ies)|same\s+famil(?:y|ies)|famil(?:y|ies)\s+names?)\b|\b[Ff]amil(?:y|ies)\s+\p{Lu}\p{Ll}{3,}/u;

/** "segments 8 and 9", "segment 3": a field guide's numbered body segments (any band; run 2026-10-06-7). */
const NUMBERED_SEGMENT_RE = /\bsegments?\s+\d+(?:\s*(?:and|to|or|-|–|,)\s*\d+)*\b/i;

/** Latin group names: Crambidae, Vespertilionidae, Asteraceae, Passeriformes, Danainae... */
const LATIN_GROUP_RE = /\b[\p{L}]{3,}(?:idae|inae|aceae|formes|oidea|opsida|phyta|mycetes|ptera)\b/iu;

/** Words with those endings that are plain English. */
const LATIN_GROUP_OK = new Set<string>(["helicoptera"]);

/**
 * The "-id" adjective of a Latin family ("a phrynosomatid reptile", "a crambid moth", "a nonvenomous
 * colubrid"): a word of 6+ letters ending in -id(s), except plain English and kid-known words.
 */
const ID_WORD_RE = /\b[\p{L}]{4,}ids?\b/giu;
const ID_OK = new Set([
  "liquid", "rapid", "solid", "humid", "vivid", "timid", "squid", "rigid", "pyramid", "orchid", "hybrid", "valid", "splendid",
  "candid", "placid", "stupid", "horrid", "morbid", "torpid", "turgid", "fluid", "cupid", "druid", "insipid", "intrepid", "vapid",
  "frigid", "livid", "lurid", "putrid", "rancid", "sordid", "tepid", "fervid", "florid", "fetid", "katydid", "aphid", "arachnid",
  "forbid", "eyelid", "afraid", "mermaid", "unpaid", "unsaid", "avoid", "asteroid", "android", "invalid", "acid", "humanoid",
  "braid", "plaid", "repaid", "outbid", "overpaid", "undid", "orchids", "aphids", "katydids", "arachnids", "pyramids", "squids",
  "eyelids", "braids", "hybrids", "fluids", "liquids", "solids", "druids", "asteroids", "mermaids", "acids", "rapids", "skid",
  "kids", "grid", "grids", "lids", "squids", "candids", "cuspid", "cuspids", "tabloid", "void", "voids", "staid", "laid", "paid",
  "said", "maid", "maids", "slid", "amid", "aid", "aids", "bid", "bids", "did", "hid", "kid", "lid", "rid", "pallid",
  // Round-6 Q-6-04: plain words that end in -id.
  "unafraid", "inlaid", "mislaid", "overlaid", "waylaid", "mantid", "mantids", "rapids",
  "squalid", "stolid", "languid", "limpid", "turbid", "rabid", "lucid", "paranoid", "steroid", "steroids", "celluloid", "nonfluid",
]);

/** "the most widespread species", "the most variable ...", "the largest member of ...": a record, not a look. */
// Round-6 Q-6-04: "the most common bird" is how people talk; "common" and "familiar" are not record trivia.
const RECORD_RE = /\b(?:most|least)\s+(?:widespread|variable|abundant|numerous|diverse)\b|\b(?:largest|smallest)\s+(?:member|species)\b/i;

/** Glossary words a child on a walk does not know, at any age (insect, bird, plant, fungus anatomy). */
const GLOSSARY_HARD = [
  "pterostigma", "pterostigmata", "tarsomere", "tarsomeres", "hindtarsomere", "hindtarsomeres", "tarsus", "tarsi", "elytra", "elytron",
  "pronotum", "scutellum", "ocelli", "ocellus", "cerci", "cercus", "ovipositor", "spiracle", "spiracles", "sternite", "tergite",
  "antennomere", "antennomeres", "mesothorax", "metathorax", "prothorax", "cephalothorax", "chelicerae", "pedipalp", "pedipalps",
  "femur", "femora", "tibia", "tibiae", "stridulate", "stridulates", "stridulation", "instar", "instars", "costa", "costal",
  "discal", "postmedian", "antemedian", "submarginal", "hindtibia", "hindtibiae",
  "supercilium", "auriculars", "remiges", "rectrices", "coverts", "lores", "malar", "culmen", "speculum", "primaries", "secondaries",
  "inflorescence", "inflorescences", "panicle", "panicles", "raceme", "racemes", "corymb", "corymbs", "umbel", "umbels", "cyme", "cymes",
  "pedicel", "pedicels", "peduncle", "peduncles", "petiole", "petioles", "stipule", "stipules", "pinnate", "bipinnate", "pinnately",
  "palmately", "lanceolate", "ovate", "obovate", "cordate", "serrate", "serrated", "serate", "dentate", "crenate", "glabrous",
  "pubescent", "tomentose", "hispid", "sessile", "axil", "axils", "axillary", "rhizome", "rhizomes", "stolon", "stolons", "achene",
  "achenes", "pappus", "involucre", "involucral", "phyllary", "phyllaries", "ligule", "ligules", "rachis", "culm", "culms",
  "coriaceous", "herbaceous", "forb", "forbs", "glaucous", "pinnae", "pinnules", "sori", "sorus", "hyphae", "mycelium", "lamellae",
  "stipe", "volva", "annulus", "basidiocarp", "basidiomycete", "ascomycete", "thallus", "apothecia", "soredia", "isidia", "fruticose",
  "foliose", "crustose", "plastron", "scutes", "dorsal", "ventral", "dorsally", "ventrally", "distal", "proximal", "apical", "basal",
  "subterminal", "terminal", "nominate", "dimorphic", "dimorphism", "morph", "morphs", "conspecific", "congeners", "sympatric",
  "endemic", "passerine", "passerines", "anuran", "anurans", "gastropod", "gastropods", "lepidopteran", "hymenopteran", "dipteran",
  "coleopteran", "odonate", "odonates", "anisopteran", "zygopteran",
];

/** Field-guide words younger children (4-6, 6-10) don't use; 10-13 may (a preference only, never a drop). */
const GLOSSARY_YOUNG = [
  "thorax", "abdomen", "abdominal", "segment", "segments", "segmented", "mandible", "mandibles", "proboscis", "larva", "larvae",
  "larval", "nymph", "nymphs", "pupa", "pupae", "sepal", "sepals", "bract", "bracts", "stamen", "stamens", "anther", "anthers", "pistil",
  "corolla", "calyx", "drupe", "drupes", "samara", "samaras", "catkin", "catkins", "margin", "margins", "leaflet", "plumage",
  "carapace", "deciduous", "perennial", "biennial", "nocturnal", "diurnal", "invertebrate", "vertebrate", "species", "terrestrial",
  "forewing", "forewings", "hindwing", "hindwings",
];

/** Field-guide words that are trivia at any age (Q-5-01): a preference. */
const GLOSSARY_TRIVIA = [
  "operculum", "opercula", "arboreal", "aquatic", "semiaquatic", "semi-aquatic", "perennial", "herbaceous", "mollusk", "mollusks",
  "mollusc", "molluscs", "legume", "legumes", "raptor", "raptors", "migratory", "colonial", "omnivorous", "insectivorous",
  "carnivorous", "herbivorous", "frugivorous", "granivorous", "invasive", "introduced", "naturalized", "cultivar", "ornamental",
  "annual", "biennial", "evergreen shrub", "deciduous",
  // Round-6 Q-6-05 / Q-6-03: field-guide words printed in run -7 and on the example passes.
  "oblong", "projection", "styles and stamens",
];

/** Round-6 Q-6-05: each word also matches its plural ("leaflet" and "leaflets"), as BLOCKED_WORD_RE does. */
const wordsRe = (list: readonly string[]) => new RegExp(`\\b(?:${[...new Set(list)].sort((a, b) => b.length - a.length).join("|")})(?:e?s)?\\b`, "i");
const HARD_RE = wordsRe(GLOSSARY_HARD);
const YOUNG_RE = wordsRe(GLOSSARY_YOUNG);
const TRIVIA_RE = wordsRe(GLOSSARY_TRIVIA);

/** A number with a unit ("16 cm", "24-39.5 g" counts 2, "1.5 m", "5 ft"). */
const UNIT = "(?:in(?=\\))|mm|cm|m|km|g|kg|mg|oz|lbs?|ft|millimet(?:er|re)s?|centimet(?:er|re)s?|met(?:er|re)s?|kilomet(?:er|re)s?|grams?|kilograms?|ounces?|pounds?|inch(?:es)?|feet|foot)";
const MEASURE_RE = new RegExp(`(\\d+(?:[.,]\\d+)?)(?:\\s*(?:[-–]|to)\\s*(\\d+(?:[.,]\\d+)?))?\\s*${UNIT}\\b`, "gi");
const MASS_RE = /\b\d+(?:[.,]\d+)?(?:\s*(?:[-–]|to)\s*\d+(?:[.,]\d+)?)?\s*(?:g|kg|mg|oz|lbs?|grams?|kilograms?|ounces?|pounds?)\b|\b(?:mass|weighs?|weight)\s+(?:of\s+|about\s+|up\s+to\s+|around\s+)?\d/i;
/** Wikipedia stat phrases ("a typical length of", "an average wingspan of"). */
const STAT_RE = /\b(?:typical|average|mean|maximum|minimum)\s+(?:length|size|height|wingspan|mass|weight)\b|\b(?:length|wingspan|mass|weight)\s+of\s+\d/i;

/** How many measurements a text has ("16 cm" and "18-20 cm" are one each; "16 cm (6.3 in)" is two). */
export function measureCount(text: string): number {
  return [...norm(text).matchAll(MEASURE_RE)].length;
}

/**
 * Jargon (drop reason `jargon`, always removed), or null. Every band: taxonomy, record trivia, the hard
 * glossary, weights, Wikipedia stat phrases and 2+ numbers with units. Ages 4-6: any measurement.
 */
export function jargonProblem(clue: string, band: AgeBand | undefined, section: "park" | "wild" | "lucky" = "wild"): string | null {
  const t = norm(clue);
  const rank = RANK_RE.exec(t) ?? FAMILY_RANK_RE.exec(t) ?? ORDER_RANK_RE.exec(t) ?? NUMBERED_SEGMENT_RE.exec(t) ?? (band === "10-13" ? null : SPECIES_RE.exec(t));
  if (rank) return rank[0];
  const latin = LATIN_GROUP_RE.exec(t);
  if (latin && !LATIN_GROUP_OK.has(latin[0].toLowerCase())) return latin[0];
  const record = RECORD_RE.exec(t);
  if (record) return record[0];
  // Round-6 Q-6-04: the field-guide checks below are about species ("bus terminal", "lift your own weight" are not).
  if (section !== "wild") return null;
  for (const m of t.matchAll(ID_WORD_RE)) {
    const w = m[0].toLowerCase();
    if (w.length >= 6 && !ID_OK.has(w)) return m[0];
  }
  const hard = HARD_RE.exec(t);
  if (hard) return hard[0];
  const mass = MASS_RE.exec(t);
  if (mass) return mass[0];
  const stat = STAT_RE.exec(t);
  if (stat) return stat[0];
  const measures = measureCount(t);
  if (measures >= 2) return `${measures} measurements`;
  if (band === "4-6" && measures >= 1) return "a measurement";
  return null;
}

/** Places a range fact names ("the south central United States": up to two direction words, an optional "the"). */
const PLACE =
  "(?:the\\s+)?(?:(?:north|south|central|eastern|western|northern|southern|east|west|north-?east|north-?west|south-?east|south-?west)[\\s-]+){0,2}(?:america|united states|u\\.s\\.|mexico|canada|texas|oklahoma|hawaii|florida|california|europe|asia|africa|australia|caribbean|the tropics|the gulf coast|louisiana|arkansas|new mexico|kansas|wisconsin|new york|the world|the americas|eurasia|the south|the southeast|the southwest|the midwest|the great plains)";
/** Range trivia: "native to ...", "common to Hawaii and Mexico", "found in North America", "from Texas and Oklahoma". */
// r7 follow-ups: "a bird that is resident in the central United States", "a lizard from the south central United
// States" (run 2026-10-06-7) and habitat words ("the tree that grows in riparian zones").
const RANGE_RE = new RegExp(
  `\\b(?:native|endemic|indigenous|common|widespread|introduced|naturali[sz]ed|resident|breeds?|breeding|winters?|wintering)\\s+(?:to|in|across|throughout)\\b|\\b(?:found|lives?|living|occurs?|ranges?|grows?|growing)\\s+(?:in|across|throughout|from)\\s+${PLACE}\\b|\\bfrom\\s+${PLACE}\\b|\\b(?:across|throughout)\\s+${PLACE}\\b|\\b${PLACE}\\s+(?:native|species)\\b|\\b(?:riparian|habitats?|ecoregions?|floodplains?|bottomlands?)\\b`,
  "i",
);

const COLOURS = "(?:white|black|brown|grey|gray|red|orange|yellow|green|blue|purple|pink|tan|gold|golden|silver|dark|pale|bright)";
/**
 * "Watch for a bird that is black." The whole trait is one or two colour words: fits half the park.
 * r7 follow-ups: up to three words before "that" ("a flying animal that is red", "a small bird that is yellow",
 * "a bug that is black and gold"; run 2026-10-06-7).
 */
const BARE_COLOUR_RE = new RegExp(`\\b(?:a|an|the)\\s+(?:[\\p{L}-]+\\s+){1,3}(?:that|which)\\s+(?:is|are|looks)\\s+(?:all\\s+|mostly\\s+)?${COLOURS}(?:\\s+(?:and|or)\\s+${COLOURS})?\\s*[.!?]?$`, "iu");

/**
 * Trivia (drop reason `trivia`, a preference: the first to go when a spare can replace it), or null:
 * range facts, glossary words a child may not know, and a bare colour as the whole trait.
 */
export function triviaProblem(clue: string, band: AgeBand | undefined): string | null {
  return triviaKind(clue, band)?.match ?? null;
}

/**
 * Which kind of trivia a clue holds (r7 follow-ups): `nothing_to_see` = a range or habitat fact, or a bare
 * colour as the whole trait (validate.ts drops it whenever the pool is not low-data, so a spare or the
 * refill replaces it); `word` = a field-guide word next to a real trait (a preference only).
 */
export function triviaKind(clue: string, band: AgeBand | undefined): { kind: "nothing_to_see" | "word"; match: string } | null {
  const t = norm(clue).trim();
  const range = RANGE_RE.exec(t);
  if (range) return { kind: "nothing_to_see", match: range[0].trim() };
  if (BARE_COLOUR_RE.test(t)) return { kind: "nothing_to_see", match: "a bare colour" };
  const trivia = TRIVIA_RE.exec(t);
  if (trivia) return { kind: "word", match: trivia[0] };
  if (band !== "10-13") {
    const young = YOUNG_RE.exec(t);
    if (young) return { kind: "word", match: young[0] };
  }
  return null;
}

// ---------- wrong kind words (r7 follow-ups) ----------

/** iNaturalist taxon ids for the kind-word check (each resolved live on api.inaturalist.org/v1/taxa/<id>, 2026-10-06). */
export const KIND_TAXA = {
  chordata: 2, // phylum Chordata
  aves: 3, // class Aves
  mollusca: 47115, // phylum Mollusca
  arachnida: 47119, // class Arachnida
  insecta: 47158, // class Insecta
  diptera: 47822, // order Diptera (true flies)
} as const;

/** Kind words a clue calls its find by. */
const BUG_WORDS = new Set(["bug", "bugs", "insect", "insects"]);
const BIRD_WORDS = new Set(["bird", "birds"]);
/** Words that end the subject phrase ("a lizard that eats bugs": the subject is "lizard", not "bugs"). */
const PHRASE_END = new Set([
  "that", "which", "who", "whose", "with", "without", "on", "in", "at", "by", "near", "of", "from", "for", "to", "and", "or", "but",
  "is", "are", "has", "have", "can", "will", "may", "eats", "catches", "hunts", "chases", "looks", "sits", "flies", "lives",
]);
/** Wild things are never pets ("a water pet" for a wild sunfish), and "pet it" would be a touch instruction. */
const PET_RE = /\bpets?\b/i;

/**
 * The words of the clue's first "a/an/the ..." phrase, up to 4 words and before any word that ends it
 * (`PHRASE_END` or an -ing verb): "Watch for a big bug with a dark body" -> ["big", "bug"];
 * "Spot a lizard eating bugs" -> ["lizard"]; "Who is a water pet that ..." -> ["water", "pet"].
 */
export function subjectWords(clue: string): string[] {
  const words = norm(clue).toLowerCase().match(/[\p{L}'-]+/gu) ?? [];
  const at = words.findIndex((w) => w === "a" || w === "an" || w === "the");
  if (at < 0) return [];
  const out: string[] = [];
  for (const w of words.slice(at + 1, at + 5)) {
    if (PHRASE_END.has(w) || (w.length > 4 && w.endsWith("ing"))) break;
    out.push(w);
  }
  return out;
}

/**
 * A kind word that is wrong for this Wild Find (r7 follow-ups, run 2026-10-06-7: "a big bug" for a tarantula,
 * "a bug that is black and gold" for a garden spider, "a water pet" for a wild sunfish, "a small fly" for a
 * damselfly), or null. Only the clue's subject phrase is judged (`subjectWords`), from the item's iNaturalist
 * lineage; an item with no lineage is only checked for "pet" (anywhere: no wild find is a pet).
 */
export function wrongKindWord(clue: string, taxon: { taxonId: number; ancestorIds: readonly number[] } | undefined): string | null {
  const pet = PET_RE.exec(norm(clue));
  if (pet) return pet[0];
  if (!taxon || taxon.ancestorIds.length === 0) return null;
  const has = (id: number) => taxon.taxonId === id || taxon.ancestorIds.includes(id);
  const subject = subjectWords(clue);
  const bug = subject.find((w) => BUG_WORDS.has(w));
  if (bug && (has(KIND_TAXA.arachnida) || has(KIND_TAXA.mollusca) || has(KIND_TAXA.chordata))) return bug;
  const bird = subject.find((w) => BIRD_WORDS.has(w));
  if (bird && !has(KIND_TAXA.aves)) return bird;
  // "a small fly" for a damselfly; dragonfly, butterfly and firefly are other words.
  if (subject.includes("fly") && has(KIND_TAXA.insecta) && !has(KIND_TAXA.diptera)) return "fly";
  return null;
}
