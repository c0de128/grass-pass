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
  { id: 67598, name: "Solenopsis invicta", common: "red imported fire ant", why: "painful stings, mounds" },
  { id: 51079, name: "Toxicodendron", common: "poison ivy, oak and sumac", why: "rash on touch" },
  { id: 48599, name: "Phytolacca americana", common: "American pokeweed", why: "poisonous berries" },
  { id: 84185, name: "Megalopyge opercularis", common: "southern flannel moth (asp caterpillar)", why: "stinging caterpillar" },
  { id: 48943, name: "Datura", common: "devil's trumpets (jimsonweed)", why: "poisonous plant" },
  { id: 52747, name: "Vespidae", common: "hornets, paper wasps and yellowjackets", why: "stings" },
  { id: 133074, name: "Cnidoscolus texanus", common: "Texas bull nettle", why: "stinging hairs" },
  { id: 53765, name: "Scolopendra", common: "giant centipedes", why: "venomous bite" },
  { id: 119059, name: "Centruroides", common: "bark scorpions", why: "venomous sting" },
  // Builder-resolved (ADR 0003 asked for Urtica via `taxa?q=Urtica&rank=genus`): iNat 51886 = genus Urtica, "nettles".
  { id: 51886, name: "Urtica", common: "nettles", why: "stinging hairs" },
  // Builder addition (live Connemara list 2026-10-05 had western horsenettle and buffalo-bur):
  // iNat 50641 = genus Solanum, "nightshades": spiny stems and poisonous berries.
  { id: 50641, name: "Solanum", common: "nightshades (horsenettle, buffalo-bur)", why: "poisonous berries, spines" },
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
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BLOCKED_WORD_RE = new RegExp(`\\b(?:${BLOCKED_WORDS.map(escapeRe).join("|")})(?:e?s)?\\b`, "i");

/** The first blocked word in `text`, or null. */
export function blockedWordIn(text: string): string | null {
  const m = BLOCKED_WORD_RE.exec(text.normalize("NFKC").replace(/[‘’]/g, "'"));
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
