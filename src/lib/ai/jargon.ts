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
 * These checks only read the clue; they never rewrite it. (The four small edits code does make to a printed clue, a
 * filler opener, "?" after a command, a stock frame and "Who" for a lichen, are in build-pass.ts and validate.ts.)
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

/** Ages 10-13 and teens & adults (13+) may read a few more words (species, the YOUNG_RE glossary words). */
const olderBand = (band: AgeBand | undefined): boolean => band === "10-13" || band === "13+";

/**
 * Jargon (drop reason `jargon`, always removed), or null. Every band: taxonomy, record trivia, the hard
 * glossary, weights, Wikipedia stat phrases and 2+ numbers with units. Ages 4-6: any measurement.
 */
export function jargonProblem(clue: string, band: AgeBand | undefined, section: "park" | "wild" | "lucky" = "wild"): string | null {
  const t = norm(clue);
  const rank = RANK_RE.exec(t) ?? FAMILY_RANK_RE.exec(t) ?? ORDER_RANK_RE.exec(t) ?? NUMBERED_SEGMENT_RE.exec(t) ?? (olderBand(band) ? null : SPECIES_RE.exec(t));
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

/**
 * Round 8 (Q-8-04): "Peek for a bird of prey that breeds from Alaska to Panama." The PLACE list can never name every
 * place, so a range is also "from <Capitalised place> to/through <Capitalised place>" (case-sensitive: a place name is
 * capitalised; "from the path to the pond" is not a range). START and X are the Find This Spot map's own words.
 */
const FROM_TO_RE =
  /\b[Ff]rom\s+(?:the\s+)?(?!START\b|X\b)\p{Lu}[\p{L}.'-]*(?:\s+\p{Lu}[\p{L}.'-]*){0,2}\s+(?:to|through|into|and)\s+(?:the\s+)?(?!START\b|X\b)\p{Lu}[\p{L}.'-]*/u;

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
  const range = RANGE_RE.exec(t) ?? FROM_TO_RE.exec(t);
  if (range) return { kind: "nothing_to_see", match: range[0].trim() };
  if (BARE_COLOUR_RE.test(t)) return { kind: "nothing_to_see", match: "a bare colour" };
  const trivia = TRIVIA_RE.exec(t);
  if (trivia) return { kind: "word", match: trivia[0] };
  if (!olderBand(band)) {
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
  lichens: 54743, // class Lecanoromycetes, "Common Lichens" (same id as danger-taxa.ts TAXA.lichens)
  lichinomycetes: 152030, // class Lichinomycetes, small lichens (same id as danger-taxa.ts)
} as const;

/** Round-6 Q-6-03: to a child a lichen is not a mushroom or a fungus; the clue says "lichen" (or what it looks like). */
const FUNGUS_WORDS = new Set(["fungus", "fungi", "funguses", "mushroom", "mushrooms", "toadstool", "toadstools"]);
/**
 * Round-6 Q-6-03: "Who has bright-orange rims ...?" for a lichen: "who" is for animals. Round 8: "Who can find ...?" is a
 * challenge to the reader, not the thing, so it is never swapped ("What can find" would be nonsense).
 */
const WHO_RE = /^(\s*(?:guess\s+)?)who\b(?!\s+(?:can|could|will|would|might|may|spots?|finds?|sees?|gets?)\b)/i;

const isLichen = (taxon: { taxonId: number; ancestorIds: readonly number[] } | undefined) =>
  !!taxon && [KIND_TAXA.lichens, KIND_TAXA.lichinomycetes].some((id) => taxon.taxonId === id || taxon.ancestorIds.includes(id));

/**
 * Round-6 Q-6-03: the recorded Gemma clue "Who has bright-orange parts with spiny projections?" (Golden-eye Lichen,
 * Connemara). A lichen is not a "who": code swaps the first word for "What" (it keeps the find; a drop would cost the
 * smallest pool a find). Other clues come back unchanged.
 */
export function fixLichenWho(clue: string, taxon: { taxonId: number; ancestorIds: readonly number[] } | undefined): string {
  if (!isLichen(taxon)) return clue;
  return clue.replace(WHO_RE, (_m, pre: string) => `${pre}${pre ? "what" : "What"}`);
}

/** iNaturalist kingdoms that are never a "who" (the same ids as validate.ts SILENT_TAXA). */
const PLANTAE = 47126;
const FUNGI = 47170;
/** Pool kinds (wild.ts) that are never a "who", for an item with no ancestor list. */
const NOT_A_WHO_KINDS: ReadonlySet<string> = new Set(["plant", "fungus or lichen"]);

/**
 * Round 8 (Q-8-04): "Who has large, intricate flowers with prominent styles and stamens?" (purple passionflower, the
 * first live 13+ pass). The lichen swap (fixLichenWho) for every plant and fungus, every band: the printed clue says
 * "What". Code changes only that first word; every other clue comes back unchanged.
 */
export function fixPlantWho(clue: string, item: { taxon?: { taxonId: number; ancestorIds: readonly number[] }; kind?: string }): string {
  const t = item.taxon;
  const inKingdom = !!t && ([PLANTAE, FUNGI].some((id) => t.taxonId === id || t.ancestorIds.includes(id)) || isLichen(t));
  const byKind = (!t || t.ancestorIds.length === 0) && NOT_A_WHO_KINDS.has(item.kind ?? "");
  if (!inKingdom && !byKind) return clue;
  return clue.replace(WHO_RE, (_m, pre: string) => `${pre}${pre ? "what" : "What"}`);
}

/**
 * Round 8 (Q-8-04): kid-style wording on a teens & adults (13+) pass, or null. The 13+ prompt asks for "plain adult
 * sentences ... no baby talk, no Who am I? riddles, no exclamation marks, never kids, friends or little"; this is the
 * code side of that list (drop reason `kid_wording`, a preference: the first to go when a spare can replace it).
 * "Point to a ride with two wheels, pedals and handlebars" (a cyclist) and "Who has ...?" read like a kid's riddle.
 */
const KID_WORDS_RE =
  /\b(?:kids?|kiddos?|friends?|buddy|buddies|little|tiny|teeny|itty|doggy|doggie|puppy|kitty|birdie|bunny|tummy|critters?|cute|yummy|a\s+ride\s+with)\b/i;
export function kidWordingProblem(clue: string): string | null {
  const t = norm(clue);
  const word = KID_WORDS_RE.exec(t);
  if (word) return word[0];
  if (t.includes("!")) return "!";
  if (/^\s*who\b(?!\s+(?:can|could|will)\b)/i.test(t)) return "a Who question";
  return null;
}

/** Kind words a clue calls its find by. */
const BUG_WORDS = new Set(["bug", "bugs", "insect", "insects"]);
const BIRD_WORDS = new Set(["bird", "birds"]);
/** Words that end the subject phrase ("a lizard that eats bugs": the subject is "lizard", not "bugs"). */
const PHRASE_END = new Set([
  "that", "which", "who", "whose", "with", "without", "on", "in", "at", "by", "near", "of", "from", "for", "to", "and", "or", "but",
  "is", "are", "has", "have", "can", "will", "may", "eats", "catches", "hunts", "chases", "looks", "sits", "flies", "lives",
  // Round-7 quality Q-7-05: "the berries a bird would eat", "the tree where a bird builds nests": a second article or a
  // clause word starts a new phrase; the bird there is not the subject.
  "a", "an", "the", "where", "when", "while", "would", "could", "should", "love", "loves", "like", "likes",
]);
/**
 * Q-7-05: head nouns of a plant (or a thing) phrase. A kind word AFTER one of these ("the plant birds love") describes
 * it; it is not the subject.
 */
const THING_HEADS = new Set([
  "plant", "plants", "tree", "trees", "vine", "vines", "bush", "bushes", "shrub", "shrubs", "flower", "flowers", "berry", "berries",
  "seed", "seeds", "fruit", "fruits", "leaf", "leaves", "nest", "nests", "grass", "weed", "weeds", "herb", "moss", "mushroom", "feeder", "house",
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
    // Q-7-05: the phrase's head noun ends it ("the plant birds love" -> ["plant"]).
    if (THING_HEADS.has(w)) break;
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
  // Round-6 Q-6-03: "Spot a fungus with bright-orange parts that have spikes." for Golden-eye Lichen (builder Z live check).
  if (isLichen(taxon)) {
    const fungus = subject.find((w) => FUNGUS_WORDS.has(w));
    if (fungus) return fungus;
  }
  return null;
}
