/**
 * Park Finds pool (SPEC F3): one item per kind of mapped feature inside the park, with a
 * code-written fact sheet ("Celebration Park has 2 basketball courts on the map (OpenStreetMap).")
 * plus two kid-level facts about that kind. Counts come from OSM; nothing is invented.
 *
 * Audit R2-M5: every park used to get the SAME one-line description per kind, and the model copied it
 * ("a roof on posts with tables underneath" on 4 parks). Now each kind has a bank of true, general
 * facts and each park gets 2 of them, picked by a hash of the park id and the kind, so two parks
 * rarely share a fact sheet. The facts never use the kind's own name words (forbidden words in the
 * source make the model leak them) and never use digits (a digit in the source would let a clue use it).
 */
import { FEATURE_KINDS, FEATURE_KIND_IDS, type FeatureKind, type ParkFeatures } from "@/lib/sources/overpass-features";
import { hasUrlOrMarkup, singularWord as singular } from "@/lib/ai/validate";
import { distinctiveWords, kindLabelWords, type PoolItem, type SectionState } from "./types";

/** SPEC §5.4, Park Finds empty copy. */
export function parkFindsEmptyCopy(parkName: string): string {
  return `No data available: OpenStreetMap has no mapped playgrounds, courts or shelters inside ${parkName}.`;
}

/** Kinds where a count is misleading (one creek is often mapped as several pieces). */
const NO_COUNT: ReadonlySet<FeatureKind> = new Set(["creek"]);

/** Fixed ordering: play and sport first, then landmarks, then nature features. */
const ORDER: readonly FeatureKind[] = FEATURE_KIND_IDS;

/**
 * Kid-level facts per kind (R2-M5). Each starts with "It" when it is about the thing itself; for a
 * count of 2 or more that "It" becomes "Each one" so the count and the fact agree.
 *
 * Content tuning (2026-10-06, M10): "{a|b}" marks word choices that say the same true thing. Each park
 * gets one choice per slot (hash of park id, kind, fact and slot), so two parks with the same fact read
 * differently. Gemma copies fact phrases into its clues (about half of all Park Find clues in run
 * 2026-10-06-2 held a 4-word run of their fact sheet), and those copies were most of the cross-park
 * repetition (M10). The grounding check is unchanged: a quote must be in that park's own text.
 */
export const KIND_FACTS: Record<FeatureKind, readonly string[]> = {
  basketball: [
    "It is a flat {hard|paved} court with a {hoop|ring} on a {tall|high} pole at {each end|both ends}.",
    "Its {hoop|ring} is {a metal ring|a round metal rim}, {often|usually} with a net {hanging down|dangling below}, fixed to a {flat|square} board.",
    "{Lines|Stripes} painted on its {hard ground|flat floor} show where {players|people} stand.",
    "{Players|People} {bounce|dribble} a big ball on it and try to {drop|toss} the ball through a {ring|hoop}.",
  ],
  tennis: [
    "It is a flat court with a {low|short} net {across the middle|stretched across its middle}.",
    "A {tall|high} {wire|metal} fence {usually|often} goes {all around|round} it to keep the balls in.",
    "{White|Painted} lines on its {ground|surface} make {long|big} boxes and {short|small} boxes.",
    "{Players|People} hit a {small|little} {fuzzy|furry} ball {back and forth|to and fro} over its net.",
  ],
  pickleball: [
    "It is a {small|short} flat court with a {low|short} net {across the middle|stretched across its middle}.",
    "{Players|People} use flat paddles to hit a {plastic|light} ball {full of|covered in} {little|tiny} holes.",
    "Lines on its {ground|surface} mark a {short|narrow} zone {right next to|close to} the net.",
  ],
  volleyball: [
    "It has a {high|tall} net {across the middle|stretched across its middle}, above the players' heads.",
    "Some are on {soft|deep} sand, and some are on grass or a {hard|flat} floor.",
    "{Players|People} {hit|bump} a big ball over its {high|tall} net with their hands and arms.",
  ],
  soccer: [
    "It is a big {grass|grassy} field with a goal {with a net|and its net} at {each end|both ends}.",
    "{White|Painted} lines on its grass mark a {big|wide} box in front of {each|every} goal.",
    "A {circle|ring} is painted on the grass in the {middle|center} of it.",
    "{Players|Kids} kick a ball {across|along} it and try to get the ball into a net.",
  ],
  baseball: [
    "It has a {dirt|sandy} infield with a base at {each corner|every corner}.",
    "A {tall|high} fence stands behind home plate to {stop|catch} the ball.",
    "A {small|low} {dirt hill|mound of dirt} in the {middle|center} of it is where the pitcher stands.",
    "{Players|Teams} wait their turn on {long|low} benches in {low|sunken} dugouts {beside|next to} it.",
  ],
  football: [
    "It is a long {grass|grassy} field with goal posts shaped like a {tall|big} letter Y or H.",
    "{White|Painted} lines cross its grass every few steps from one end to the other.",
    "The {tall|high} goal posts at {each end|both ends} of it are {often|usually} painted yellow.",
  ],
  sports_field: [
    "It is an open {marked|lined} area where people play games.",
    "Painted lines or {flat|wide} open grass show where a game is played on it.",
    "{Teams|Players} and families use it for {running games|ball games} and practice.",
  ],
  playground: [
    "It is a place with things to {climb, slide and swing on|climb up, slide down and swing on|climb, swing on and slide down}.",
    "The ground under it is {often|usually} soft: {wood chips, sand or rubber|sand, rubber or wood chips|rubber, wood chips or sand}.",
    "Kids climb {ladders and steps|steps and ladders} on it to reach the top of the {play set|climbing frame}.",
    "It {often|usually} has a {low|short} fence or a border {around|round} it.",
  ],
  slide: [
    "It is a smooth slope you sit on and {zoom|whoosh|zip} down.",
    "You climb up {steps|stairs} or a ladder to reach its top.",
    "Some are straight, and some {twist|curl|wind} round and round like a {curl|spiral|corkscrew}.",
    "Many are {shiny|smooth} metal or {bright|colourful} plastic.",
  ],
  swing: [
    "It is a seat that hangs from {chains|ropes} and moves back and forth.",
    "A {tall|high} frame holds it up from above.",
    "Some seats are flat, and some are a {big|wide} round {basket|nest} you can lie in.",
  ],
  climbing: [
    "It has bars, ropes or holds to climb up and across.",
    "You hold on with your hands and feet to go up high on it.",
    "Some look like a big web of rope, and some are metal bars in squares.",
  ],
  sandbox: [
    "It is a {low|shallow} box filled with sand for digging.",
    "Kids build castles and tunnels in its soft sand.",
    "It has {low|short} walls of wood, stone or plastic {around|round} it.",
  ],
  seesaw: [
    "It is a long board that goes up and down with a rider at each end.",
    "It balances on a bar in the middle.",
    "When one end of it goes up, the other end goes down.",
  ],
  spring_rider: [
    "It is a little seat on a big metal coil that rocks back and forth.",
    "Many are shaped like an animal or a car.",
    "It wobbles in every direction when you lean.",
  ],
  merry_go_round: [
    "It is a round platform that spins when you push it.",
    "It has bars to hold on to while it turns.",
    "Kids run beside it, push, then jump on for a ride.",
  ],
  zip_line: [
    "It has a seat or handle that rolls along a cable.",
    "Its cable is stretched tight between two posts.",
    "You hold on and whoosh from one end of it to the other.",
  ],
  splash_pad: [
    "It is a play area with water that {sprays|squirts|shoots} up from the ground.",
    "Its ground is flat, with no deep water to swim in.",
    "Water can {shoot|spray|squirt} from {little|tiny} holes, buckets or arches on it.",
  ],
  shelter: [
    "It has a {roof|cover} {on|held up by} {posts|poles|pillars} and tables {underneath|below it} where people {eat lunch|have picnics|share a meal}.",
    "It gives {shade|cool shade} from the sun and {cover|a dry spot} {from|in} the rain.",
    "Its sides are open, so the {wind|breeze} {blows|moves|passes} right through it.",
    "{Families|Neighbours} and {groups|friends} {often|sometimes} meet under it for {parties|birthdays} and picnics.",
  ],
  picnic_table: [
    "It is an outdoor table with {benches|seats} {attached|joined on}.",
    "Its seats are {joined|fixed} to the table on both long sides.",
    "Many are made of {wood, metal or thick plastic|thick plastic, wood or metal|metal, wood or thick plastic}.",
    "People sit on both sides of it to {eat a meal|have a snack|share food} outside.",
  ],
  bench: [
    // Audit R3-C1: "long outdoor seats" and "metal box on a post" were printed on several example parks.
    "It is a {long outdoor seat|long seat out in the open|wide seat outside|long seat outdoors} for {resting|taking a break|a rest}.",
    "Many face a {path|trail|walkway} or a {nice|pretty} view.",
    "Some have a back to lean on and {arms|armrests} at the ends.",
    "They can be made of {wood, metal or stone|stone, wood or metal|metal, stone or wood}.",
  ],
  fountain: [
    "It {sprays|spurts|pours} water into a {pool|bowl|basin}.",
    "You can hear its water {splashing|splish-splashing|gurgling} as you get {close|near}.",
    "Some shoot water up {high|into the air}, and some let it {trickle|dribble|run} down.",
  ],
  drinking_water: [
    "It gives you a {sip|drink} of water when you {press|push} a button.",
    "A {little|small} arc of water {bubbles|pops|bobs} up from its spout.",
    "Some have a {low|short} spout for kids or a bowl for dogs.",
  ],
  bbq: [
    "It is a {metal box|metal cooker|low metal box|metal fire box} {on|up on|set on} a {post|pole|stand} where people cook food.",
    "It has a metal {grate|rack} on top where food sits over hot coals.",
    "It is often {black|dark} from smoke and old fires.",
  ],
  dog_park: [
    "It is a fenced area where dogs can run {off the leash|free}.",
    "It often has two gates in a row, so dogs can't slip out.",
    "You may hear barking and see balls being {thrown|tossed} inside it.",
  ],
  fitness: [
    "It has bars or machines for stretching and {working out|getting strong}.",
    "A sign by it often shows pictures of how to do each move.",
    "Grown-ups do pull-ups, push-ups and step-ups on it.",
  ],
  pool: [
    "It is a big tank of water for swimming.",
    "It has a deep end and a shallow end.",
    "A tall fence goes around it to keep people safe when it is closed.",
  ],
  track: [
    "It is an oval path with lanes for running.",
    "Lines split it into long lanes side by side.",
    "It is often red or black and feels bouncy under your feet.",
  ],
  garden: [
    "It is a planted area with flowers or plants that people look after.",
    "Its plants grow in rows or in {neat|tidy} beds with edges.",
    "Some have small labels that tell the plant names.",
  ],
  bleachers: [
    "They are rows of {benches|seats} stepped up high so people can watch a game.",
    "They are usually metal and {next to|beside} a field or court.",
    "Each row is a step higher than the one in front of it.",
  ],
  artwork: [
    "It is something an artist made for everyone to see, like a shape of metal or stone, or a big painting on a wall.",
    "It may be {bright and colourful|colourful and bright}, or old and worn by the weather.",
    "Some have a small sign that tells who made it.",
  ],
  info_board: [
    "It is a board with words and pictures about the park.",
    "It stands on posts near a {path|trail} or a parking lot.",
    "It may show trails, plants or animals that live nearby.",
  ],
  viewpoint: [
    "It is a {spot|perch} with a {good|wide} view across the park.",
    "It is often higher up than the land {around|round} it.",
    "From there you can see {far away|a long way|a great distance}.",
  ],
  water: [
    "It is still water where you may see {ducks, turtles or fish|turtles, fish or ducks|fish, ducks or turtles}.",
    "Its edge may have {reeds, rocks or mud|rocks, mud or reeds|mud, reeds or rocks}.",
    "On a calm day it {shines|gleams|glitters} like a mirror.",
    "Ripples spread across it when a fish jumps or a bird lands.",
  ],
  creek: [
    "It is a {narrow|thin} {line|ribbon} of moving water with a {muddy or rocky|rocky or muddy} bank on {each side|both sides}.",
    "{Running|Flowing} water in it can make a {soft|gentle|quiet} {rushing|bubbling|gurgling} sound.",
    "After rain it runs fast, and in dry weather it may be just puddles.",
  ],
  bridge: [
    "It lets a path cross over water or a dip in the ground.",
    "Many have {rails|railings} on {the sides|both sides|each side} to hold on to.",
    "You may hear your feet {thump|clomp|tap} on its {boards|planks} as you walk across.",
  ],
  tower: [
    "It is a tall, narrow structure you can see from far away.",
    "Some have stairs inside that go up to the top.",
    "It stands up above the trees around it.",
  ],
  flagpole: [
    "It is a very tall pole that holds a flag up high.",
    "On windy days its flag flaps and snaps.",
    "A rope runs up its side to raise and lower the flag.",
  ],
  historic: [
    "It is a sign or object that tells something from long ago.",
    "It may be a metal plaque, a stone or an old building.",
    "Its words often tell what happened here and when.",
  ],
};

/**
 * R2-M5 count accuracy: the words a count clue may count for each kind, singular. A clue may count
 * the whole thing the map counts ("courts", "seats", "ways over the water"), never a part of it
 * ("hoops", "goals", "nets": 25 soccer fields are not 25 goals). The kind's own label words are
 * added by `countNouns`.
 */
const COUNT_NOUNS: Record<FeatureKind, readonly string[]> = {
  basketball: ["court"],
  tennis: ["court"],
  pickleball: ["court"],
  volleyball: ["court"],
  soccer: ["field", "pitch"],
  baseball: ["field", "infield"],
  football: ["field"],
  sports_field: ["field", "area"],
  playground: ["area", "set"],
  slide: ["slope"],
  swing: ["seat"],
  climbing: ["frame", "structure"],
  sandbox: ["box", "pit"],
  seesaw: ["board"],
  spring_rider: ["seat", "rocker"],
  merry_go_round: ["platform", "spinner"],
  zip_line: ["cable", "ride"],
  splash_pad: ["pad", "area"],
  shelter: ["roof", "hut", "building", "cover"],
  picnic_table: ["table"],
  bench: ["seat"],
  fountain: ["fountain"],
  drinking_water: ["fountain", "spout"],
  bbq: ["box", "cooker"],
  dog_park: ["area", "yard", "pen"],
  fitness: ["station"],
  pool: ["pool", "tank"],
  track: ["track", "oval", "loop"],
  garden: ["bed", "area"],
  bleachers: ["stand", "set"],
  artwork: ["piece", "work"],
  info_board: ["board", "sign"],
  viewpoint: ["spot", "view"],
  water: ["pool", "patch"],
  creek: [],
  bridge: ["way", "crossing", "walkway", "path"],
  tower: ["structure"],
  flagpole: ["pole", "flag"],
  historic: ["sign", "plaque", "site", "spot"],
};

/** The singular nouns a count clue for this kind may count (R2-M5). */
export function countNouns(kind: FeatureKind): Set<string> {
  const info = FEATURE_KINDS[kind];
  const lastWord = (s: string) => s.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean).pop() ?? "";
  return new Set([...COUNT_NOUNS[kind], singular(lastWord(info.label)), singular(lastWord(info.plural))].filter((w) => w.length > 0));
}

/** FNV-1a 32-bit: a stable small hash for picking facts (same park + kind -> same facts every time). */
export function seedHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

/** How many facts each Park Find gets. */
export const FACTS_PER_ITEM = 2;

/**
 * The facts this park gets for this kind: FACTS_PER_ITEM in a row from the kind's bank, starting at a
 * place picked by hash(park id + kind). "It is ..." becomes "Each one is ..." for a count of 2 or more.
 */
export function factsFor(kind: FeatureKind, parkId: string, count: number): string[] {
  const bank = KIND_FACTS[kind];
  const start = seedHash(`${parkId}|${kind}`) % bank.length;
  const picked: string[] = [];
  for (let i = 0; i < Math.min(FACTS_PER_ITEM, bank.length); i++) {
    const at = (start + i) % bank.length;
    picked.push(chooseWords(bank[at], `${parkId}|${kind}|${at}`));
  }
  const many = count > 1 && !NO_COUNT.has(kind);
  return picked.map((f) => (many ? f.replace(/^It (?=[a-z])/, "Each one ") : f));
}

/** One fact with each "{a|b|c}" slot replaced by one choice, picked by a hash of `seed` and the slot (stable). */
export function chooseWords(template: string, seed: string): string {
  let slot = 0;
  return template.replace(/\{([^{}]*)\}/g, (_, opts: string) => {
    const choices = opts.split("|");
    return choices[seedHash(`${seed}|${slot++}`) % choices.length];
  });
}

const article = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");

/** "2 basketball courts"; a count of 1 is "a basketball court" (R2-M5: no "There is 1." count clues). */
function countPhrase(kind: FeatureKind, count: number): string {
  const info = FEATURE_KINDS[kind];
  if (NO_COUNT.has(kind) || count === 1) return `${article(info.label)} ${info.label}`;
  return `${count} ${info.plural}`;
}

/** The map count a Park Find's source states, or null for a single thing or a kind that is never counted. */
export function sourceCount(kind: FeatureKind, count: number): number | null {
  return NO_COUNT.has(kind) || count < 2 ? null : count;
}

export function parkPool(f: ParkFeatures): { items: PoolItem[]; state: SectionState } {
  const items: PoolItem[] = [];
  for (const kind of ORDER) {
    const entry = f.features[kind];
    if (!entry || entry.count < 1) continue;
    const info = FEATURE_KINDS[kind];
    // R1-m7: anyone can edit an OSM name. A name with a link, domain, @handle or phone-like digits
    // ("Text 555 0100 for a prize at kidsprize.com") never reaches the prompt or the answer key.
    const names = entry.names.filter((nm) => !hasUrlOrMarkup(nm));
    const named = names.length > 0 ? ` Mapped name${names.length > 1 ? "s" : ""}: ${names.join(", ")}.` : "";
    const facts = factsFor(kind, f.park.id, entry.count).join(" ");
    const sourceText = `${f.park.name} has ${countPhrase(kind, entry.count)} on the map (OpenStreetMap).${named} ${facts}`;
    const evidence = NO_COUNT.has(kind)
      ? "on the park map · OpenStreetMap"
      : entry.count === 1
        ? "1 on the park map · OpenStreetMap"
        : `${entry.count} on the park map · OpenStreetMap`;
    const what = capitalize(entry.count > 1 && !NO_COUNT.has(kind) ? info.plural : info.label);
    const answer = names.length > 0 ? `${what} (${names.join(", ")})` : what;
    items.push({
      id: `osm-${kind.replace(/_/g, "-")}`,
      section: "park",
      kind: info.label,
      sourceText,
      answer,
      evidence,
      source: "OpenStreetMap",
      nameWords: [
        ...new Set([
          ...info.nameWords.map((w) => w.toLowerCase()),
          ...names.flatMap((nm) => distinctiveWords(nm, { place: true, allowed: kindLabelWords(info) })),
        ]),
      ],
      safety: kind === "water" || kind === "creek" ? "Stay with your grown-up near water." : null,
      stationary: true,
      count: { of: [...countNouns(kind)], n: sourceCount(kind, entry.count) },
    });
  }
  return items.length > 0 ? { items, state: { status: "ok" } } : { items, state: { status: "empty", message: parkFindsEmptyCopy(f.park.name) } };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
