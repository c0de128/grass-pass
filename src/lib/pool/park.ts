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
 */
export const KIND_FACTS: Record<FeatureKind, readonly string[]> = {
  basketball: [
    "It is a flat hard court with a hoop on a tall pole at each end.",
    "Its hoop is a metal ring, often with a net hanging down, fixed to a flat board.",
    "Lines painted on its hard ground show where players stand.",
    "Players bounce a big ball on it and try to drop the ball through a ring.",
  ],
  tennis: [
    "It is a flat court with a low net across the middle.",
    "A tall wire fence usually goes all around it to keep the balls in.",
    "White lines on its ground make long boxes and short boxes.",
    "Players hit a small fuzzy ball back and forth over its net.",
  ],
  pickleball: [
    "It is a small flat court with a low net across the middle.",
    "Players use flat paddles to hit a plastic ball full of little holes.",
    "Lines on its ground mark a short zone right next to the net.",
  ],
  volleyball: [
    "It has a high net across the middle, above the players' heads.",
    "Some are on soft sand, and some are on grass or a hard floor.",
    "Players hit a big ball over its high net with their hands and arms.",
  ],
  soccer: [
    "It is a big grass field with a goal with a net at each end.",
    "White lines on its grass mark a big box in front of each goal.",
    "A circle is painted on the grass in the middle of it.",
    "Players kick a ball across it and try to get the ball into a net.",
  ],
  baseball: [
    "It has a dirt infield with a base at each corner.",
    "A tall fence stands behind home plate to stop the ball.",
    "A small dirt hill in the middle of it is where the pitcher stands.",
    "Players wait their turn on long benches in low dugouts beside it.",
  ],
  football: [
    "It is a long grass field with goal posts shaped like a tall letter Y or H.",
    "White lines cross its grass every few steps from one end to the other.",
    "The tall goal posts at each end of it are often painted yellow.",
  ],
  sports_field: [
    "It is an open marked area where people play games.",
    "Painted lines or flat open grass show where a game is played on it.",
    "Teams and families use it for running games and practice.",
  ],
  playground: [
    "It is a place with things to climb, slide and swing on.",
    "The ground under it is often soft: wood chips, sand or rubber.",
    "Kids climb ladders and steps on it to reach the top of the play set.",
    "It often has a low fence or a border around it.",
  ],
  slide: [
    "It is a smooth slope you sit on and zoom down.",
    "You climb up steps or a ladder to reach its top.",
    "Some are straight, and some twist round and round like a curl.",
    "Many are shiny metal or bright plastic.",
  ],
  swing: [
    "It is a seat that hangs from chains or ropes and moves back and forth.",
    "A tall frame holds it up from above.",
    "Some seats are flat, and some are a big round basket you can lie in.",
  ],
  climbing: [
    "It has bars, ropes or holds to climb up and across.",
    "You hold on with your hands and feet to go up high on it.",
    "Some look like a big web of rope, and some are metal bars in squares.",
  ],
  sandbox: [
    "It is a low box filled with sand for digging.",
    "Kids build castles and tunnels in its soft sand.",
    "It has low walls of wood, stone or plastic around it.",
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
    "It is a play area with water that sprays up from the ground.",
    "Its ground is flat, with no deep water to swim in.",
    "Water can shoot from little holes, buckets or arches on it.",
  ],
  shelter: [
    "It has a roof on posts and tables underneath where people eat lunch.",
    "It gives shade from the sun and cover from the rain.",
    "Its sides are open, so the wind blows right through it.",
    "Families and groups often meet under it for parties and picnics.",
  ],
  picnic_table: [
    "It is an outdoor table with benches attached.",
    "Its seats are joined to the table on both long sides.",
    "Many are made of wood, metal or thick plastic.",
    "People sit on both sides of it to eat a meal outside.",
  ],
  bench: [
    "It is a long outdoor seat for resting.",
    "Many face a path or a nice view.",
    "Some have a back to lean on and arms at the ends.",
    "They can be made of wood, metal or stone.",
  ],
  fountain: [
    "It sprays or pours water into a pool or basin.",
    "You can hear its water splashing as you get close.",
    "Some shoot water up high, and some let it trickle down.",
  ],
  drinking_water: [
    "It gives you a sip of water when you press a button.",
    "A little arc of water bubbles up from its spout.",
    "Some have a low spout for kids or a bowl for dogs.",
  ],
  bbq: [
    "It is a metal box on a post where people cook food.",
    "It has a metal grate on top where food sits over hot coals.",
    "It is often black from smoke and old fires.",
  ],
  dog_park: [
    "It is a fenced area where dogs can run off the leash.",
    "It often has two gates in a row, so dogs can't slip out.",
    "You may hear barking and see balls being thrown inside it.",
  ],
  fitness: [
    "It has bars or machines for stretching and working out.",
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
    "Its plants grow in rows or in neat beds with edges.",
    "Some have small labels that tell the plant names.",
  ],
  bleachers: [
    "They are rows of benches stepped up high so people can watch a game.",
    "They are usually metal and next to a field or court.",
    "Each row is a step higher than the one in front of it.",
  ],
  artwork: [
    "It is something an artist made for everyone to see, like a shape of metal or stone, or a big painting on a wall.",
    "It may be bright and colourful, or old and worn by the weather.",
    "Some have a small sign that tells who made it.",
  ],
  info_board: [
    "It is a board with words and pictures about the park.",
    "It stands on posts near a path or a parking lot.",
    "It may show trails, plants or animals that live nearby.",
  ],
  viewpoint: [
    "It is a spot with a good view across the park.",
    "It is often higher up than the land around it.",
    "From there you can see far away.",
  ],
  water: [
    "It is still water where you may see ducks, turtles or fish.",
    "Its edge may have reeds, rocks or mud.",
    "On a calm day it shines like a mirror.",
    "Ripples spread across it when a fish jumps or a bird lands.",
  ],
  creek: [
    "It is a narrow line of moving water with a muddy or rocky bank on each side.",
    "Running water in it can make a soft rushing sound.",
    "After rain it runs fast, and in dry weather it may be just puddles.",
  ],
  bridge: [
    "It lets a path cross over water or a dip in the ground.",
    "Many have rails on the sides to hold on to.",
    "You may hear your feet thump on its boards as you walk across.",
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
  shelter: ["roof", "hut", "building"],
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
  for (let i = 0; i < Math.min(FACTS_PER_ITEM, bank.length); i++) picked.push(bank[(start + i) % bank.length]);
  const many = count > 1 && !NO_COUNT.has(kind);
  return picked.map((f) => (many ? f.replace(/^It (?=[a-z])/, "Each one ") : f));
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
