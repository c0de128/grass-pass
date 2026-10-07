/**
 * Kid safety by code (ADR 0003, SPEC F7). The model never decides what is safe.
 *
 * 1. HARD BLOCK: a species is never on a pass when its iNaturalist taxon id, or any of its
 *    `ancestor_ids`, is in BLOCKED_TAXA. Applied to the pool BEFORE the model sees it, and again
 *    to every item the model picked (defence in depth). Every id below was resolved live on
 *    iNaturalist (`/v1/taxa/<ids>`) on 2026-10-05; the comment names what iNat returned.
 * 2. TEXT RE-CHECK: a clue or "look where" hint that names a blocked thing ("poison ivy",
 *    "recluse"...) is dropped, even when its item is safe (e.g. "looks like poison ivy").
 * 3. SAFETY LINES: every Wild Find carries a fixed, code-written line ("Look, don't touch.").
 */

export type BlockedTaxon = { id: number; name: string; common: string; why: string };

export const BLOCKED_TAXA: readonly BlockedTaxon[] = [
  { id: 48137, name: "Loxosceles", common: "recluse spiders", why: "venomous bite" },
  { id: 47370, name: "Latrodectus", common: "widow spiders", why: "venomous bite" },
  { id: 30668, name: "Agkistrodon", common: "copperheads and cottonmouths", why: "venomous snake" },
  { id: 30692, name: "Crotalus", common: "rattlesnakes", why: "venomous snake" },
  { id: 30979, name: "Sistrurus", common: "massasaugas", why: "venomous snake" },
  { id: 30493, name: "Micrurus", common: "coralsnakes", why: "venomous snake" },
  // Round-7 SEC-7-01: widened from the species (Solenopsis invicta 67598) to the genus. iNat 67597 = genus Solenopsis,
  // "Solenopsis Fire Ants and Thief Ants" (the insect; the plant genus Solenopsis is 181095). The tropical fire ants
  // (geminata group 1373017) have no summary to catch.
  { id: 67597, name: "Solenopsis", common: "fire ants (red imported fire ant, tropical fire ant)", why: "painful stings, mounds" },
  { id: 51079, name: "Toxicodendron", common: "poison ivy, oak and sumac", why: "rash on touch" },
  // Audit R5-S1 (2026-10-06): widened from the species (Phytolacca americana 48599) to the genus. iNat 48601 = genus Phytolacca, "Pokeweeds".
  { id: 48601, name: "Phytolacca", common: "pokeweeds", why: "poisonous berries" },
  { id: 84185, name: "Megalopyge opercularis", common: "southern flannel moth (asp caterpillar)", why: "stinging caterpillar" },
  { id: 48943, name: "Datura", common: "devil's trumpets (jimsonweed)", why: "poisonous plant" },
  { id: 52747, name: "Vespidae", common: "hornets, paper wasps and yellowjackets", why: "stings" },
  { id: 133074, name: "Cnidoscolus texanus", common: "Texas bull nettle", why: "stinging hairs" },
  { id: 53765, name: "Scolopendra", common: "giant centipedes", why: "venomous bite" },
  // Round-7 SEC-7-01/02: widened from the bark scorpions (Centruroides 119059) to the order. iNat 48894 = order
  // Scorpiones, "Scorpions" (Southern Devil Scorpion, Vaejovis carolinianus 60912, had a neutral summary).
  { id: 48894, name: "Scorpiones", common: "scorpions (striped bark scorpion, devil scorpions)", why: "venomous sting" },
  // Builder-resolved (ADR 0003 asked for Urtica via `taxa?q=Urtica&rank=genus`): iNat 51886 = genus Urtica, "nettles".
  { id: 51886, name: "Urtica", common: "nettles", why: "stinging hairs" },
  // Builder addition (live Connemara list 2026-10-05 had western horsenettle and buffalo-bur):
  // iNat 50641 = genus Solanum, "nightshades": spiny stems and poisonous berries.
  { id: 50641, name: "Solanum", common: "nightshades (horsenettle, buffalo-bur)", why: "poisonous berries, spines" },
  // Audit R5-S1 (2026-10-06): a live 10-13 pass for Tenney Park printed white snakeroot as "a poisonous perennial herb".
  // Common North American plants and fungi that are deadly or badly poisonous to eat, or that burn the skin, and
  // that a child could touch or put in their mouth. Every id was resolved live on iNaturalist
  // (`/v1/taxa?q=<genus>&rank=genus`, 2026-10-06); the comment names what iNat returned.
  { id: 64116, name: "Ageratina", common: "snakeroots (white snakeroot)", why: "poisonous plant" }, // genus Ageratina, "snakeroots"
  { id: 60126, name: "Cicuta", common: "water hemlocks", why: "deadly if eaten" }, // genus Cicuta, "water hemlocks"
  { id: 52999, name: "Conium", common: "poison hemlock", why: "deadly if eaten" }, // genus Conium (no common name on iNat)
  { id: 54899, name: "Pastinaca", common: "wild parsnip", why: "sap burns skin in sunlight" }, // genus Pastinaca, "parsnips"
  { id: 53095, name: "Heracleum", common: "hogweeds and cow parsnip", why: "sap burns skin in sunlight" }, // genus Heracleum, "hogweeds"
  { id: 53725, name: "Melia", common: "chinaberry", why: "poisonous berries" }, // genus Melia (no common name on iNat)
  { id: 47564, name: "Nerium", common: "oleander", why: "poisonous in all parts" }, // genus Nerium, "oleanders"
  { id: 56740, name: "Ricinus", common: "castor bean", why: "deadly seeds" }, // genus Ricinus, "Castor Beans" (the plant; not the louse genus 907186)
  { id: 47555, name: "Taxus", common: "yews", why: "poisonous seeds and leaves" }, // genus Taxus, "yews"
  { id: 468609, name: "Dermatophyllum", common: "Texas mountain laurel", why: "poisonous seeds" }, // genus Dermatophyllum (no common name on iNat)
  { id: 50334, name: "Lantana", common: "lantanas", why: "poisonous berries" }, // genus Lantana, "Lantanas"
  { id: 50311, name: "Arisaema", common: "jack-in-the-pulpits", why: "berries and roots burn the mouth" }, // genus Arisaema
  // Fungi stay "look, don't touch, never eat" (ADR 0003), except the genera behind most deadly mushroom poisonings.
  { id: 48419, name: "Amanita", common: "amanitas (death cap, destroying angel, fly agaric)", why: "deadly mushrooms" }, // genus Amanita
  { id: 118297, name: "Galerina", common: "galerinas (funeral bell)", why: "deadly mushrooms" }, // genus Galerina, "Moss Bells"
  { id: 117308, name: "Chlorophyllum molybdites", common: "green-spored parasol", why: "poisonous mushroom often found on lawns" }, // species, "Green-spored Parasol"
  // r7 follow-ups (eval run 2026-10-06-7, ADR 0003 "nothing a kid could get hurt by touching or eating is a find").
  // Ids resolved live on iNaturalist 2026-10-06 (`/v1/taxa?q=<name>&rank=<rank>`; species checked through their ancestor_ids).
  // Snow-on-the-prairie (Euphorbia bicolor 120585) printed on 4 Cedar Ridge passes; its summary never says its milky
  // sap burns skin and eyes, so the word filter cannot see it. Every spurge has that latex: the whole genus goes.
  { id: 51822, name: "Euphorbia", common: "spurges (snow-on-the-prairie, snow-on-the-mountain, spotted spurge)", why: "milky sap irritates skin and eyes" }, // genus Euphorbia, "Spurges"
  // Texas Brown Tarantula (Aphonopelma hentzi 120596) printed on Arbor Hills passes as "a big bug". Big, slow and
  // tempting to touch: it flicks itchy hairs and can bite. A touch hazard like the asp caterpillar, so it is blocked
  // (other spiders stay "Look, don't touch.").
  { id: 47424, name: "Theraphosidae", common: "tarantulas", why: "itchy hairs and a painful bite" }, // family Theraphosidae, "Tarantulas"
  // Stinging wasps beyond Vespidae (blocked since ADR 0003). Organ-pipe Mud-dauber (Trypoxylon politum 84844, under
  // Crabronidae 51955) printed at Trinity. iNat has no Pemphredonidae / Bembicidae family: they sit in Crabronidae.
  { id: 48742, name: "Sphecidae", common: "thread-waisted wasps (mud daubers)", why: "stings" }, // family Sphecidae, "Thread-waisted Wasps"
  { id: 51955, name: "Crabronidae", common: "square-headed and sand wasps (organ-pipe mud dauber, cicada killer)", why: "stings" }, // family Crabronidae
  { id: 1269342, name: "Pompiloidea", common: "spider wasps (tarantula hawks) and velvet ants", why: "very painful stings" }, // superfamily Pompiloidea
  { id: 51967, name: "Scoliidae", common: "scoliid wasps", why: "stings" }, // family Scoliidae, "Scoliid Wasps"
  { id: 371108, name: "Tiphioidea", common: "tiphiid flower wasps", why: "stings" }, // superfamily Tiphioidea
  { id: 605157, name: "Thynnidae", common: "thynnid flower wasps (five-banded thynnid)", why: "stings" }, // family Thynnidae
  // Blister beetles: their body fluid (cantharidin) blisters the skin of a child who picks one up.
  { id: 59510, name: "Meloidae", common: "blister beetles", why: "body fluid blisters skin" }, // family Meloidae, "Blister Beetles"
  // Round-6 security SEC-6-01 + quality Q-6-01 (2026-10-06): common North Texas species whose Wikipedia lead describes
  // looks and range, not danger, so the word filter has nothing to catch. Genus level where every member shares the
  // hazard. Ids resolved live on iNaturalist 2026-10-06 (`/v1/taxa?q=<name>&rank=genus|family`, exact name match).
  { id: 83071, name: "Gelsemium", common: "Carolina jessamine", why: "every part is poisonous" }, // genus Gelsemium
  { id: 82771, name: "Erythrina", common: "coral bean, coral trees", why: "poisonous seeds" }, // genus Erythrina, "Coral trees"
  { id: 72030, name: "Campsis", common: "trumpet creeper (cow itch vine)", why: "sap causes skin rash" }, // genus Campsis, "trumpet vines" (rank 3 near Connemara)
  { id: 126547, name: "Nandina", common: "nandina (heavenly bamboo)", why: "poisonous berries" }, // genus Nandina
  { id: 69819, name: "Ligustrum", common: "privets", why: "poisonous berries" }, // genus Ligustrum, "privets" (Quihoui privet at Cedar Ridge)
  { id: 53350, name: "Aesculus", common: "buckeyes", why: "poisonous nuts" }, // genus Aesculus, "buckeyes and horse-chestnuts"
  { id: 56089, name: "Robinia", common: "black locust", why: "poisonous seeds and bark" }, // genus Robinia, "Locust Trees"
  { id: 72405, name: "Tragia", common: "noseburns", why: "stinging hairs" }, // genus Tragia, "noseburns"
  { id: 132171, name: "Mucuna", common: "velvet bean", why: "itchy hairs on the pods" }, // genus Mucuna
  { id: 147272, name: "Dieffenbachia", common: "dumbcanes", why: "sap burns the mouth" }, // genus Dieffenbachia
  { id: 141506, name: "Caladium", common: "caladiums", why: "sap burns the mouth" }, // genus Caladium
  { id: 50280, name: "Parthenocissus", common: "Virginia creeper", why: "poisonous berries" }, // genus Parthenocissus, "Virginia Creepers"
  { id: 1555996, name: "Nephroia", common: "Carolina snailseed", why: "poisonous berries" }, // genus Nephroia (iNat moved Carolina snailseed 1555999 out of Cocculus; at Celebration)
  { id: 49671, name: "Phoradendron", common: "American mistletoe", why: "poisonous berries" }, // genus Phoradendron, "leafy mistletoes"
  { id: 51267, name: "Wisteria", common: "wisterias", why: "poisonous seeds and pods" }, // genus Wisteria
  { id: 48230, name: "Ranunculus", common: "buttercups", why: "sap blisters skin and mouth" }, // genus Ranunculus, "buttercups"
  { id: 64014, name: "Omphalotus", common: "jack-o'-lantern mushrooms", why: "poisonous mushroom that looks like a chanterelle" }, // genus Omphalotus
  // Stinging caterpillars beyond the asp (Megalopyge opercularis, above): the whole flannel-moth and slug-moth
  // families (saddleback Acharia stimulea, hag moth Phobetron), io moths and buck moths.
  { id: 84186, name: "Megalopygidae", common: "flannel moths (puss caterpillars)", why: "stinging caterpillars" }, // family Megalopygidae
  { id: 84165, name: "Limacodidae", common: "slug caterpillar moths (saddleback, hag moth)", why: "stinging caterpillars" }, // family Limacodidae
  { id: 82286, name: "Automeris", common: "io moths", why: "stinging caterpillars" }, // genus Automeris, "Eyed Silkmoths"
  { id: 82145, name: "Hemileuca", common: "buck moths", why: "stinging caterpillars" }, // genus Hemileuca, "Sheepmoths"
  { id: 64819, name: "Rhinella", common: "cane toad", why: "poisonous skin" }, // genus Rhinella, "Beaked Toads"
  // Velvet ants (Mutillidae 48511, "cow killer" Dasymutilla occidentalis 117221) are inside Pompiloidea 1269342 above.
  // Round-7 security SEC-7-01 (2026-10-06): a second sweep of common DFW species found touch/bite/eat hazards that
  // passed every filter (iNat's own summary is cut off before the danger sentence, e.g. Chinese tallow "The plant sap
  // and leaves..."). Ids resolved live on iNaturalist 2026-10-06 (`/v1/taxa?q=<name>&rank=<rank>`, exact name match);
  // a real species under each is in tests/fixtures/inat-taxa-sec7-hazards-and-lookalikes.json.
  { id: 48959, name: "Reduviidae", common: "assassin bugs (wheel bug, kissing bugs)", why: "very painful bite; kissing bugs carry Chagas disease" }, // family Reduviidae, "Assassin Bugs"
  { id: 69114, name: "Pogonomyrmex", common: "harvester ants (red harvester ant)", why: "very painful venomous sting" }, // genus Pogonomyrmex, "Typical American Harvester Ants"
  { id: 51672, name: "Ixodida", common: "ticks (lone star tick, American dog tick)", why: "bites that spread disease" }, // order Ixodida, "Ticks"
  { id: 72408, name: "Triadica", common: "Chinese tallow", why: "poisonous sap, leaves and berries" }, // genus Triadica (no common name on iNat)
  { id: 133292, name: "Rivina", common: "pigeonberry (rougeplant)", why: "poisonous berries" }, // genus Rivina (no common name on iNat)
  { id: 57280, name: "Ailanthus", common: "tree-of-heaven", why: "sap irritates skin" }, // genus Ailanthus, "Trees-of-Heaven"
  { id: 62832, name: "Sapindus", common: "soapberries (western soapberry)", why: "poisonous berries" }, // genus Sapindus, "Soapberry"
  { id: 155712, name: "Ungnadia", common: "Mexican buckeye", why: "poisonous seeds" }, // genus Ungnadia, "Mexican buckeyes"
];

const BLOCKED_IDS = new Map(BLOCKED_TAXA.map((t) => [t.id, t]));

export type TaxonLike = { taxonId: number; ancestorIds: readonly number[] };

/** The blocked group this taxon belongs to (itself or any ancestor), or null when allowed. */
export function blockedBy(t: TaxonLike): BlockedTaxon | null {
  const own = BLOCKED_IDS.get(t.taxonId);
  if (own) return own;
  for (const a of t.ancestorIds) {
    const hit = BLOCKED_IDS.get(a);
    if (hit) return hit;
  }
  return null;
}

export const isBlocked = (t: TaxonLike) => blockedBy(t) !== null;

/**
 * Words that must never appear in a printed clue or hint (whole words, any case, plural ok).
 * Covers common names of every blocked group above.
 */
export const BLOCKED_WORDS: readonly string[] = [
  "recluse",
  "widow spider",
  "black widow",
  "brown widow",
  "copperhead",
  "cottonmouth",
  "water moccasin",
  "rattlesnake",
  "rattler",
  "massasauga",
  "coral snake",
  "coralsnake",
  "fire ant",
  "poison ivy",
  "poison oak",
  "poison sumac",
  "pokeweed",
  "pokeberry",
  "poke berry",
  "asp caterpillar",
  "puss caterpillar",
  "flannel moth",
  "jimsonweed",
  "datura",
  "devil's trumpet",
  "wasp",
  "hornet",
  "yellowjacket",
  "yellow jacket",
  "bull nettle",
  "nettle",
  "horsenettle",
  "buffalo-bur",
  "buffalobur",
  "nightshade",
  "centipede",
  "scorpion",
  // Audit R5-S1 additions (common names of the new blocked groups).
  "snakeroot",
  "hemlock",
  "cowbane",
  "wild parsnip",
  "hogweed",
  "cow parsnip",
  "chinaberry",
  "oleander",
  "castor bean",
  "yew",
  "mountain laurel",
  "lantana",
  "jack-in-the-pulpit",
  "amanita",
  "death cap",
  "destroying angel",
  "fly agaric",
  "funeral bell",
  "false parasol",
  // r7 follow-ups (common names of the new blocked groups).
  "spurge",
  "snow-on-the-prairie",
  "snow-on-the-mountain",
  "tarantula",
  "mud dauber",
  "mud-dauber",
  "cicada killer",
  "velvet ant",
  "cow killer",
  "blister beetle",
  // Round-6 SEC-6-01 (common names of the new blocked groups).
  "jessamine",
  "coral bean",
  "trumpet creeper",
  "cow itch",
  "nandina",
  "privet",
  "buckeye",
  "black locust",
  "noseburn",
  "velvet bean",
  "dumbcane",
  "caladium",
  "virginia creeper",
  "snailseed",
  "mistletoe",
  "wisteria",
  "buttercup",
  "jack-o'-lantern",
  "saddleback",
  "hag moth",
  "io moth",
  "buck moth",
  "cane toad",
  // Round-7 SEC-7-01 (common names of the new blocked groups). Ticks are named in full: a bare "tick" would also hit
  // the harmless tick-trefoils and beggar-ticks, which are only checked by their own words.
  "assassin bug",
  "wheel bug",
  "kissing bug",
  "conenose",
  "harvester ant",
  "lone star tick",
  "dog tick",
  "deer tick",
  "wood tick",
  "black-legged tick",
  "blacklegged tick",
  "seed tick",
  "chinese tallow",
  "tallowtree",
  "tallow tree",
  "popcorn tree",
  "pigeonberry",
  "rougeplant",
  "tree-of-heaven",
  "tree of heaven",
  "soapberry",
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BLOCKED_WORD_RE = new RegExp(`\\b(?:${BLOCKED_WORDS.map(escapeRe).join("|")})(?:e?s)?\\b`, "i");

/**
 * Round-6 SEC-6-02: Latin look-alike letters from Cyrillic and Greek ("t\u043Exic" with a Cyrillic o) folded to
 * Latin before any safety match. NFKC does not fold them.
 */
const CONFUSABLES: Readonly<Record<string, string>> = {
  "\u0430": "a", "\u0435": "e", "\u043E": "o", "\u0440": "p", "\u0441": "c", "\u0443": "y", "\u0445": "x", "\u0456": "i",
  "\u0458": "j", "\u0455": "s", "\u0501": "d", "\u04BB": "h", "\u04CF": "l", "\u043A": "k", "\u0432": "b", "\u043D": "h",
  "\u0442": "t", "\u043C": "m", "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041A": "K", "\u041C": "M", "\u041D": "H",
  "\u041E": "O", "\u0420": "P", "\u0421": "C", "\u0422": "T", "\u0425": "X", "\u0423": "Y", "\u0406": "I", "\u0408": "J",
  "\u0405": "S", "\u03B1": "a", "\u03BF": "o", "\u03BD": "v", "\u03C1": "p", "\u03C4": "t", "\u03B9": "i", "\u03BA": "k",
  "\u03C5": "u", "\u03B5": "e", "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0396": "Z", "\u0397": "H", "\u0399": "I",
  "\u039A": "K", "\u039C": "M", "\u039D": "N", "\u039F": "O", "\u03A1": "P", "\u03A4": "T", "\u03A5": "Y", "\u03A7": "X",
};
/** Round-7 SEC-7-03: Latin small capitals ("\u1D1B\u1D0Fx\u026A\u1D04" reads "toxic") are letters that NFKC keeps. */
const SMALL_CAPITALS: Readonly<Record<string, string>> = {
  "\u1D00": "a", "\u0299": "b", "\u1D04": "c", "\u1D05": "d", "\u1D07": "e", "\uA730": "f", "\u0262": "g", "\u029C": "h",
  "\u026A": "i", "\u1D0A": "j", "\u1D0B": "k", "\u029F": "l", "\u1D0D": "m", "\u0274": "n", "\u1D0F": "o", "\u1D18": "p",
  "\uA7AF": "q", "\u0280": "r", "\uA731": "s", "\u1D1B": "t", "\u1D1C": "u", "\u1D20": "v", "\u1D21": "w", "\u028F": "y",
  "\u1D22": "z",
};
const FOLD: Readonly<Record<string, string>> = { ...CONFUSABLES, ...SMALL_CAPITALS };
const CONFUSABLE_RE = new RegExp(`[${Object.keys(FOLD).join("")}]`, "gu");
/** Round-7 SEC-7-03: invisible letters that are neither format characters (Cf) nor marks: the Hangul fillers. */
const INVISIBLE_LETTERS_RE = /[\u115F\u1160\u3164\uFFA0]/gu;

/**
 * Text as the safety checks read it (round-6 SEC-6-02, round-7 SEC-7-03): split into letters and marks (NFKD) and
 * every combining mark removed ("to\u0308xic", "poi\u034Fsonous" with a combining grapheme joiner, "pois\u0336onous"
 * struck through, variation selectors), then NFKC; invisible format characters removed (soft hyphen, zero-width
 * space and joiners, word joiner, BOM: "p\u00ADoisonous" is "poisonous") and the Hangul fillers; Cyrillic/Greek
 * look-alikes and Latin small capitals folded to Latin, curly apostrophes made straight, one space between words.
 */
export function safetyText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(INVISIBLE_LETTERS_RE, "")
    .replace(CONFUSABLE_RE, (c) => FOLD[c] ?? c)
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ");
}

/** The first blocked word in `text`, or null. */
export function blockedWordIn(text: string): string | null {
  const m = BLOCKED_WORD_RE.exec(safetyText(text));
  return m ? m[0] : null;
}

// ---------- fixed safety lines (code-written, printed with every Wild Find) ----------

/** iNaturalist taxon ids used for safety lines (verified live 2026-10-05). */
export const TAXA = {
  plants: 47126, // kingdom Plantae
  fungi: 47170, // kingdom Fungi, "Fungi Including Lichens"
  lichens: 54743, // class Lecanoromycetes, "Common Lichens" (verified live 2026-10-06)
  lichinomycetes: 152030, // class Lichinomycetes, small lichens (verified live 2026-10-06)
  lepidoptera: 47157, // order Lepidoptera, butterflies and moths
  honeyBees: 47220, // genus Apis
  bumbleBees: 52775, // genus Bombus
  mammals: 40151, // class Mammalia
  birds: 3, // class Aves
  reptiles: 26036, // class Reptilia
  amphibians: 20978, // class Amphibia
} as const;

export const SAFETY_LINES = {
  fungi: "Look, don't touch. Never eat wild mushrooms.",
  lichen: "Look, don't touch. Never eat lichens, and leave them where they grow.",
  berries: "Look, don't touch. Never eat wild berries or fruit.",
  prickly: "Look, don't touch. It has sharp spines or thorns.",
  plant: "Look, don't pick or eat.",
  caterpillar: "Look, don't touch. Some caterpillars sting.",
  bee: "Look, don't touch. It can sting.",
  wildlife: "Watch from far away. Never chase or touch.",
  small: "Look, don't touch.",
  water: "Stay with your grown-up near water.",
} as const;

export const SAFETY_FOOTNOTE = "Some things seen here are left off for safety.";

const has = (t: TaxonLike, id: number) => t.taxonId === id || t.ancestorIds.includes(id);
const BERRY_RE = /\b(berr(y|ies)|fruits?|drupes?)\b/i;
/** A lichen is a fungus in iNaturalist's tree, but not a mushroom: its own words decide too ("a fruticose lichen"). */
const LICHEN_RE = /\blichens?\b/i;
const PRICKLY_RE = /\b(spines?|spined|spiny|thorns?|thorny|prickl\w*|barbs?|burs?|burrs?|stinging)\b/i;

/** The fixed safety line for a Wild Find. `sourceText` decides the berry line for plants. */
export function safetyLineFor(t: TaxonLike, sourceText: string): string {
  if (has(t, TAXA.lichens) || has(t, TAXA.lichinomycetes)) return SAFETY_LINES.lichen;
  if (has(t, TAXA.fungi)) return LICHEN_RE.test(sourceText) ? SAFETY_LINES.lichen : SAFETY_LINES.fungi;
  if (has(t, TAXA.plants)) {
    if (PRICKLY_RE.test(sourceText)) return SAFETY_LINES.prickly;
    return BERRY_RE.test(sourceText) ? SAFETY_LINES.berries : SAFETY_LINES.plant;
  }
  if (has(t, TAXA.lepidoptera)) return SAFETY_LINES.caterpillar;
  if (has(t, TAXA.honeyBees) || has(t, TAXA.bumbleBees)) return SAFETY_LINES.bee;
  if (has(t, TAXA.mammals) || has(t, TAXA.birds) || has(t, TAXA.reptiles) || has(t, TAXA.amphibians)) return SAFETY_LINES.wildlife;
  return SAFETY_LINES.small;
}

/** Things that stay put (plants, fungi) are easier to find than birds that fly away (SPEC §6.1). */
export function isStationary(t: TaxonLike): boolean {
  return has(t, TAXA.plants) || has(t, TAXA.fungi);
}

// ---------- danger words in source text and in model text (audit R5-S1) ----------

/**
 * Audit R5-S1 (2026-10-06): a named-taxa list can never hold every poisonous species. White snakeroot
 * reached a live 10-13 pass because its own Wikipedia summary ("is a poisonous perennial herb") was
 * quoted in the clue. Any Wild Find whose source text (iNaturalist names + Wikipedia summary) says it
 * is poisonous, toxic, venomous, deadly, stings, burns or irritates the skin is left off the pass
 * before the model sees it. Measured on the 231 recorded summaries of the 20 eval parks: white
 * snakeroot, flowerpot parasol ("poisonous, if consumed") and Lindheimer's senna ("lethally toxic to
 * livestock") hit; nothing harmless did once negations ("nonvenomous", "no venom") are taken out.
 */
/**
 * Round-6 SEC-6-02 / Q-6-01: ONE danger-word list for the species source text and for model-written text (the two
 * lists had drifted: "can kill livestock" passed the source check, "itch" and "bite" passed both). Added: death,
 * kill(s), necrosis, itch/itchy/itching, irritate(s), allergic, anaphylaxis, urticating, painful, unsafe to eat,
 * inedible. Checked against the 231 recorded summaries of the 20 eval parks (r7-followups report).
 *
 * Round-7 SEC-7-01/03: "bite(s)/biting" moved here from the model-text list (the Lone Star tick "bites painlessly";
 * "bite-sized" is still fine), plus cyanide, seizures, carcinogen, rabies, Chagas, Lyme, hospitalization, medical
 * attention, emetic, purgative, severe pain, swelling, and any "...dermatitis" ("phytodermatitis"). Checked against
 * the 308 distinct recorded summaries in tests/fixtures (safety-r7 report).
 */
const DANGER_WORDS =
  String.raw`\w*poison\w*|\w*toxi[cn]\w*|\w*venom\w*|deadly|fatal\w*|lethal\w*|irrita\w*|itch|itches|itchy|itching|rash(?:es)?|\w*dermatitis|blister\w*|stings?|stinging|stinger\w*|hallucinogen\w*|psychoactive|dangerous|harmful|vomit\w*|caustic|deaths?|kills?|killing|necros\w*|necrotic|allerg\w*|anaphyla\w*|urticat\w*|painful(?:ly)?|do not eat|don't eat|should not be eaten|not be eaten|not edible|inedible|unsafe to eat|causes? burns?|burns? the skin|bites?(?!-)|biting|cyanide\w*|seizures?|carcinogen\w*|rabies|chagas|lyme|hospitali[sz]\w*|medical attention|emetic|purgative|severe pain|swelling`;
const DANGER_SOURCE_RE = new RegExp(String.raw`\b(?:${DANGER_WORDS})\b`, "i");

/** Words about stings: bees are "look, don't touch: it can sting" by design (ADR 0003), so for them only these are ignored. */
const STING_ONLY_RE = /^(?:stings?|stinging|stinger\w*|painful(?:ly)?)$/i;

/**
 * Negated danger words ("nonvenomous", "non-toxic", "not poisonous", "no venom", "not considered
 * dangerous") say the opposite and are taken out before the check. "Mildly venomous" is not a negation.
 */
const NEGATED_RE =
  /\b(?:non-?|not\s+(?:considered\s+|known\s+to\s+be\s+|thought\s+to\s+be\s+)?|no\s+|never\s+|nor\s+)(?:\w*poison\w*|\w*toxi[cn]\w*|venom\w*|dangerous|harmful|deadly)\b|\bharmless\b|\b(?:does\s+not|do\s+not|doesn't|don't|will\s+not|won't|cannot|can't|never|seldom|rarely|not\s+known\s+to|unlikely\s+to)\s+bites?\b/gi;

const normalizeText = safetyText;

const BITE_ONLY_RE = /^(?:bites?|biting)$/i;
/** "harmless", "nonvenomous", "non-venomous", "no venom", "not venomous" (the sentence says the bite is no danger). */
const HARMLESS_SENTENCE_RE = /\b(?:harmless|non-?venomous|no\s+venom|not\s+venomous)\b/i;

/**
 * The first danger word in a Wild Find's SOURCE text (names + summary), or null when it reads safe.
 * `taxon` (optional) lets the bees' own sting words through (ADR 0003 keeps bees with a sting line).
 */
export function dangerSourceWord(text: string, taxon?: TaxonLike): string | null {
  const bee = taxon ? has(taxon, TAXA.honeyBees) || has(taxon, TAXA.bumbleBees) : false;
  const re = new RegExp(DANGER_SOURCE_RE.source, "gi");
  for (const sentence of normalizeText(text).split(/(?<=[.!?;])\s+/)) {
    // Round-7 SEC-7-01: a bite in a sentence that also says the animal is harmless or has no venom (rough greensnake:
    // "Even when bites occur, they have no venom and are harmless") is not a danger. Any other danger word still is.
    const harmlessSentence = HARMLESS_SENTENCE_RE.test(sentence);
    for (const m of sentence.replace(NEGATED_RE, " ").matchAll(re)) {
      if (bee && STING_ONLY_RE.test(m[0])) continue;
      if (harmlessSentence && BITE_ONLY_RE.test(m[0])) continue;
      return m[0];
    }
  }
  return null;
}

/**
 * Danger words that must never be printed in a clue, hint or riddle (audit R5-S1, post-model check).
 * No negation is allowed here: "a snake that is not venomous" is no sentence for a kids' pass either.
 */
/** The shared list (since round 7 it holds "bite(s)/biting" too: Q-6-01 "a big hairy spider that can bite"; "bite-sized" is fine). */
const DANGER_CLUE_RE = new RegExp(String.raw`\b(?:${DANGER_WORDS})\b`, "i");

/** The first danger word in a model-written clue / hint / riddle, or null. */
export function dangerClueWord(text: string): string | null {
  const m = DANGER_CLUE_RE.exec(normalizeText(text));
  return m ? m[0] : null;
}
