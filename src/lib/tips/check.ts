/**
 * Trip tips, step 3: the code checks on every tip the model writes (the model never decides what is safe or true).
 *
 * SAFETY (drop the tip): a web address, @handle or phone number (src/lib/safety/contact.ts); an instruction to touch,
 * pick, catch, feed or hold something (src/lib/safety/handling.ts, the same check as the clues); going into the water
 * (swim, wade, splash in the creek...); drinking from a creek or pond; leaving the path; medicine or doses; eating
 * anything found in the park. Round 10 added pair rules (`riskyTip`): a risky action together with water, ice, a hazard
 * or an animal in any wording ("Cool off in the creek", "Walk on the frozen pond", "Follow the snake", "Throw bread to
 * the ducks"), unless a negation governs it (round 11: right before it, as in "Don't let the kids ..."). Round 12 added
 * same-tip rules (a risky act anywhere in a tip that also names water, ice, food + an animal, or a dangerous animal),
 * eating wild plants and kids leaving their grown-up; "without"/"skip"/"instead of" no longer count as negations, and
 * a few look-alikes are rewritten first ("Watch the ducks swim", "Feed the kids lunch"). Tips may still NAME a hazard to warn about it ("Watch for snakes"),
 * so the clue word lists (blockedWordIn, dangerClueWord) are not used here.
 *
 * GROUNDING (drop the tip): every place, weather or wildlife word in a tip must be backed by a real input fact
 * (`TOPICS`: "creek" needs a mapped creek, "rain" a rain chance of 30% or more, "ticks" a tick sighting...), and every
 * number in it must appear in a fact. The tip must cite a fact id from the input; its "why" line is that fact's text,
 * written by code. If the cited fact is about something else but another fact backs the tip, that fact is used.
 *
 * VOICE: a 13+ pass is held by the reader, so a tip that talks about "the kids" is dropped there.
 */
import { hasUrlOrMarkup } from "@/lib/safety/contact";
import { handlingInstruction } from "@/lib/safety/handling";
import { isAdultBand, type AgeBand } from "@/lib/pass/constants";
import type { FactTag, TipFact } from "./facts";
import { MAX_TIPS, TIP_ICONS, TIP_MAX, type TipIcon, type TripTip } from "./schema";

/** A tip as the model answers it (lenient: each one is checked on its own). */
export type TipDraft = { tip?: unknown; factId?: unknown; icon?: unknown };

export type TipDropReason = "shape" | "unknown_fact" | "unsafe" | "contact" | "handling" | "not_grounded" | "number" | "voice" | "duplicate";

/** A topic word in a tip, and the fact tags that back it (any one is enough). */
type Topic = { name: string; re: RegExp; backedBy: readonly FactTag[] };

export const TOPICS: readonly Topic[] = [
  // "warm jackets" is cold-weather advice, "stay cool" is hot-weather advice: each is left to its own topic.
  { name: "heat", re: /\b(hot|heat|warm(?:est|er)?(?!\s+(?:jackets?|coats?|clothes|clothing|layers?|hats?|sweaters?|gloves|socks))|sweaty|sweating|overheat\w*)\b/i, backedBy: ["hot", "warm", "afternoon_heat"] },
  { name: "cold", re: /\b(cold|chilly|(?<!stay |keep )cool(?:er|est)?(?!\s+(?:off|down))|coats?|jackets?|sweaters?|sweatshirts?|hoodies?|gloves|mittens|layers?)\b/i, backedBy: ["cold", "chilly", "layers", "cool_morning", "wind", "rain"] },
  { name: "rain", re: /\b(rain|rainy|raining|rainfall|umbrellas?|raincoats?|rain jackets?|ponchos?|wet(?!\s+wipes?)|puddles?)\b/i, backedBy: ["rain", "storm"] },
  { name: "mud", re: /\b(mud|muddy)\b/i, backedBy: ["rain", "storm", "creek", "water"] },
  { name: "storm", re: /\b(storms?|stormy|thunder\w*|lightning)\b/i, backedBy: ["storm"] },
  { name: "sun", re: /\b(sunscreen|sunblock|sunburn\w*|sunglasses|sunny|uv|sun)\b/i, backedBy: ["uv", "uv_high", "clear", "hot", "warm"] },
  { name: "shade", re: /\b(shade|shady|shaded)\b/i, backedBy: ["shelter", "shade_trees"] },
  { name: "shelter", re: /\b(shelters?|pavilions?|gazebos?)\b/i, backedBy: ["shelter"] },
  { name: "wind", re: /\b(wind\w*|breez\w*|gusts?|gusty)\b/i, backedBy: ["wind"] },
  { name: "dark", re: /\b(sunset|dark|dusk|nightfall)\b/i, backedBy: ["sunset"] },
  { name: "creek", re: /\b(creeks?|streams?|rivers?|brooks?)\b/i, backedBy: ["creek"] },
  { name: "pond", re: /\b(ponds?|lakes?)\b/i, backedBy: ["water"] },
  { name: "waterside", re: /\b(shore\w*|banks?|water's edge|waterside)\b/i, backedBy: ["creek", "water"] },
  { name: "fountain", re: /\b(fountains?|refill\w*)\b/i, backedBy: ["drinking_water", "no_drinking_water"] },
  { name: "restroom", re: /\b(restrooms?|bathrooms?|toilets?|potty|loo)\b/i, backedBy: ["restroom", "no_restroom"] },
  { name: "playground", re: /\b(playgrounds?|swings?|slides?)\b/i, backedBy: ["playground"] },
  { name: "splash", re: /\bsplash pads?\b/i, backedBy: ["splash_pad"] },
  { name: "picnic", re: /\b(picnic\w*|tables?)\b/i, backedBy: ["picnic", "shelter"] },
  { name: "bench", re: /\bbench(?:es)?\b/i, backedBy: ["bench"] },
  { name: "bridge", re: /\bbridges?\b/i, backedBy: ["bridge"] },
  { name: "dogs", re: /\b(dogs?|dog park)\b/i, backedBy: ["dogs"] },
  { name: "trails", re: /\b(trails?)\b/i, backedBy: ["paths", "nature"] },
  { name: "mosquito", re: /\bmosquito\w*\b/i, backedBy: ["mosquito"] },
  { name: "tick", re: /\bticks?\b/i, backedBy: ["tick"] },
  { name: "chigger", re: /\bchiggers?\b/i, backedBy: ["chigger"] },
  { name: "bugs", re: /\b(bug ?spray|insect repellent|repellent|bugs?|insects?|bug bites?)\b/i, backedBy: ["mosquito", "tick", "chigger", "fire_ant"] },
  { name: "poison_ivy", re: /\bpoison (?:ivy|oak|sumac)\b/i, backedBy: ["poison_ivy"] },
  { name: "ants", re: /\b(ants?|ant hills?|ant mounds?|mounds?)\b/i, backedBy: ["fire_ant"] },
  { name: "snake", re: /\bsnakes?\b/i, backedBy: ["snake"] },
  { name: "wasp", re: /\b(wasps?|bees?|hornets?|yellow ?jackets?|stings?|stinging)\b/i, backedBy: ["wasp", "stinging_plant", "caterpillar", "fire_ant"] },
  { name: "nettle", re: /\bnettles?\b/i, backedBy: ["stinging_plant"] },
  { name: "caterpillar", re: /\bcaterpillars?\b/i, backedBy: ["caterpillar"] },
  { name: "tall_grass", re: /\b(tall grass|long grass|brush)\b/i, backedBy: ["tick", "chigger", "nature"] },
  { name: "fog", re: /\b(fog|foggy|mist)\b/i, backedBy: ["fog"] },
  { name: "winter", re: /\b(snow\w*|ice|icy|slippery|frost\w*)\b/i, backedBy: ["winter", "rain"] },
  { name: "alert", re: /\b(alerts?|warnings?|advisory|advisories)\b/i, backedBy: ["alert"] },
  { name: "nature", re: /\b(preserve|reserve|wild ?life)\b/i, backedBy: ["nature", "poison_ivy", "tick", "snake"] },
];

/** Advice we never give, whatever the model says (each a full-word pattern). */
const UNSAFE: readonly RegExp[] = [
  // Into the water.
  /\b(swim\w*|wad(?:e|ing)|splash(?:ing)? (?:in|into|around in)|dip (?:your|their)|jump in|get in(?:to)? the water|into the (?:creek|stream|pond|lake|river|water)|paddl\w*|kayak\w*|canoe\w*|rock[- ]hop\w*)\b/i,
  // Drinking from it.
  /\bdrink\w* (?:from|out of) (?:the |a )?(?:creek|stream|pond|lake|river|fountain in the pond)\b/i,
  // Leaving the path.
  /\b(off[- ]trail|off the (?:path|trail)s?|leave the (?:path|trail)|shortcuts?|bushwhack\w*|explore the woods|into the woods|cross the (?:creek|stream))\b/i,
  // Medicine and doses (a tip is never medical advice).
  /\b(\d+\s?mg|milligrams?|doses?|dosage|ibuprofen|acetaminophen|tylenol|advil|motrin|aspirin|benadryl|antihistamines?|medicines?|medications?|epipens?|epinephrine|inhalers?|pills?|deet\b)/i,
  // Eating or picking what grows there, and wildlife contact the handling check may phrase differently.
  // Round 12 (Q-12-01): "feed the ducks" moved to the pair rules, so "Don't let the kids feed the ducks" stays a warning.
  /\b(forag\w*|berries|(?:mul|dew|black|elder|hack|choke|poke|goose|huckle|service|june|beauty|salmon|thimble)berr(?:y|ies)|mushrooms|edible|pet the|hold (?:a|the) (?:snake|frog|toad|turtle|lizard))\b/i,
];

/*
 * Round 10 (SEC-10-01 / Q-10-02): the phrase list above missed most ways of saying "go into the water" ("Cool off in
 * the creek", "Walk on the frozen pond", "Drink the creek water"). These PAIR rules look for a risky action together
 * with water, ice, a hazard or an animal, in any wording. A rule is skipped when its match is negated in the same
 * clause ("Don't let the kids walk on the frozen pond", "Stay away from the fire ant mounds"). The probe list in
 * tests/unit/trip-tips-safety-r10.test.ts is permanent: every probe there must stay dropped.
 */
/** Natural water nobody should drink from or get into. */
const NAT = String.raw`(?:creeks?|streams?|ponds?|lakes?|rivers?|brooks?|puddles?|bayous?|marsh(?:es)?|swamps?|waterfalls?)`;
/** Places to get into: natural water, "the water", ice and fountains (a splash pad is not on this list: it is for playing in). */
const INTO = String.raw`(?:${NAT}|water|ice|fountains?|creek ?beds?|stream ?beds?|river ?beds?|shallows)`;
/** Words that make the water word a place name or a dry spot next to it ("the creek trail", "the lake shore"). */
const DRY_AFTER = String.raw`(?!['’]s\b|\s+(?:trails?|paths?|loops?|bridges?|side|banks?|shores?|edge|overlook|walk|park|map|area|bottles?|from|for|fountains?|shoes?|views?))`;
/** Movement or contact verbs that put a body in or on the water when followed by in/into/on/across ... water. */
const ENTRY_VERBS = String.raw`(?:get|go|goes|going|went|step|stand|walk|wander|play|cool|splash|sit|jump|put|dip|stick|hop|climb|run|slide|skate|lie|lay|float|soak|reach|explore|venture|wash|rinse|dangle|kick|paddle|stomp|race|ride|bike|stay|cross|tiptoe|leap)\w*`;
const HAZARDS = String.raw`(?:snakes?|copperheads?|cottonmouths?|rattlesnakes?|rattlers?|water moccasins?|moccasins?|poison (?:ivy|oak|sumac)|fire ants?|ants?|ant ?hills?|ant mounds?|mounds?|wasps?|bees?|hornets?|yellow ?jackets?|nests?|hives?|nettles?|caterpillars?|spiders?|webs?|scorpions?|centipedes?|ticks?|chiggers?|mushrooms?|fung(?:us|i)|toadstools?|berries|coyotes?|bobcats?|alligators?|gators?|holes?|burrows?|dens?)`;
const ANIMALS = String.raw`(?:ducks?|ducklings?|geese|goose|goslings?|swans?|birds?|herons?|egrets?|squirrels?|rabbits?|bunn(?:y|ies)|turtles?|frogs?|toads?|tadpoles?|lizards?|deer|fawns?|armadillos?|raccoons?|possums?|opossums?|skunks?|foxes|fox|animals?|wildlife|fish|crawdads?|crayfish|minnows?|${HAZARDS})`;
/** Seeking out a hazard ("Look for snakes"); "watch for" is the warning wording and stays allowed. */
const SEEK_VERBS = String.raw`(?:look\w* (?:for|under|in(?:side|to)?)|search\w* for|hunt\w* for|find|spot|go see|visit)`;
/** Verbs that are contact or risk whenever a hazard or an animal is in the same tip. */
const RISK_VERBS = String.raw`(?:touch\w*|hug\w*|pick\w*|pull\w*|collect\w*|gather\w*|smell\w*|sniff\w*|follow\w*|chas\w+|pok\w+|prod\w*|flip\w*|lift\w*|catch\w*|caught|hold\w*|pet|pets|petting|feed\w*|fed|kick\w*|stomp\w*|step on|grab\w*|disturb\w*|bother\w*|teas\w+|approach\w*|corner\w*|dig\w*|taste\w*|tasting|eat|eats|eating|lick\w*|uproot\w*|play\w* with|get close\w*|get closer|go close\w*|up close|scoop\w*|net|trap\w*|keep (?:one|it|them)|take (?:one|it|them) home|pick\w* up|shake\w*|stir\w*|squish\w*|crush\w*|step\w* (?:in|into|on))`;

/** Round 12: an animal word that is part of a place name ("the Duck Pond Trail", "Turtle Creek"). */
const ANIMAL_NOT_PLACE = String.raw`${ANIMALS}\b(?!\s+(?:ponds?|lakes?|creeks?|parks?|islands?|bridges?|roads?|streets?|lanes?|drives?|blinds?|overlooks?|playgrounds?|gardens?|signs?|statues?|sculptures?|murals?|crossings?|meadows?|hills?|point|cove|hollow))`;
/** Round 12 (Q-12-01): animals and plants a kid should never pose with, wave at or get close to. */
const DANGER = String.raw`(?:snakes?|copperheads?|cottonmouths?|rattlesnakes?|rattlers?|water moccasins?|moccasins?|poison (?:ivy|oak|sumac)|fire ants?|ant ?hills?|ant mounds?|wasps?|bees?|hornets?|yellow ?jackets?|nests?|hives?|beehives?|nettles?|caterpillars?|spiders?|webs?|scorpions?|centipedes?|coyotes?|bobcats?|alligators?|gators?|skunks?|raccoons?)`;
/** Food a kid might hand to wildlife. */
const FOOD = String.raw`(?:snacks?|food|bread|crumbs?|crusts?|treats?|seeds?|bird ?seed|crackers?|chips|popcorn|leftovers?|lunch|scraps?|nuts|peanuts|corn|lettuce|grapes|apples?|sandwich(?:es)?|cereal|cookies?|fries|fruit|veggies|vegetables|bites?|pieces?|some of (?:your|their|the|our))`;
/** Wild things nobody should eat ("Try the wild onions", "Snack on the honeysuckle"). */
const WILD_FOOD = String.raw`(?:\w*berr(?:y|ies)|mushrooms?|fung(?:us|i)|toadstools?|acorns?|nectar|honeysuckle|clover|leaf|leaves|plants?|flowers?|petals?|weeds?|seeds?|nuts|pecans?|persimmons?|plums?|grapes?|onions?|garlic|dandelions?|mint|herbs?|roots?|bark|sap|fruit|greens|sorrel|cactus|prickly pears?)\b(?!\s+(?:trees?|shade|grove|orchard))`;
/** Natural water anywhere in the tip, for the "same tip" rules ("the pond's edge" counts; "water bottles" does not). */
const WET_PLACE = new RegExp(String.raw`\b(?:${NAT}|ditch(?:es)?|canals?|the water(?!\s+(?:fountains?|bottles?|refill|stations?|shoes)))\b`, "i");
const ANIMAL_IN = new RegExp(String.raw`\b${ANIMALS}\b`, "i");
const DANGER_IN = new RegExp(String.raw`\b${DANGER}\b`, "i");
const FOOD_IN = new RegExp(String.raw`\b${FOOD}\b`, "i");
const ICE_IN = /\b(?:frozen|ice|iced|icy)\b/i;
/** Verbs that put a body on rocks, logs, railings or an edge. */
const PERCH = String.raw`(?:sit|stand|perch|balanc|walk|climb|lean|dangl|jump|play|hop|step|run|lie|lay|scrambl|cross|crawl|tiptoe|leap|hang|swing)\w*\s+(?:on top of|out on|on|onto|along|across|over|atop|up|from|off)\s+(?:the\s+|a\s+|those\s+|these\s+|some\s+|its\s+|their\s+)?(?:[\w'-]+\s+){0,3}?`;

/**
 * A pair rule. `re` finds the risky words; each match is skipped when a negation governs it (see riskyTip). Round 12:
 * `need` makes it a SAME-TIP rule: the match counts only when every `need` pattern is also somewhere in the tip ("Share
 * your snacks" + an animal + food; "so hop in" + a creek), so the wording around them does not matter.
 */
type PairRule = { name: string; re: RegExp; need?: readonly RegExp[] };
const PAIR_RULES: readonly PairRule[] = [
  // Drinking or filling from natural water ("Drink the creek water", "Fill your bottles from the creek", "Sip the lake water").
  { name: "drink", re: new RegExp(String.raw`\b(?:drink|sip|gulp|fill|refill|filter|scoop)\w*\b(?:\s+[\w']+){0,4}?\s+(?:from|out of|at|in|with)\s+(?:the\s+|a\s+|that\s+|this\s+)?(?:\w+\s+)?${NAT}\b`, "i") },
  { name: "drink", re: new RegExp(String.raw`\b(?:drink|sip|gulp|fill|refill|filter|tast)\w*\b.*\b(?:${NAT}|untreated|wild)[- ]water\b|\b(?:${NAT}|untreated|wild)[- ]water\b.*\b(?:drink|sip|gulp|safe to|refill|fill)\w*\b`, "i") },
  // Into or onto the water or the ice ("Cool off in the creek", "Walk on the frozen pond", "Stand in the shallow water").
  { name: "water", re: new RegExp(String.raw`\b${ENTRY_VERBS}\b(?:\s+[\w']+){0,3}?\s+(?:in|into|on|onto|across|through|under)\s+(?:the\s+|a\s+|that\s+|this\s+|its\s+|their\s+|some\s+)?(?:[\w']+\s+)?${INTO}\b${DRY_AFTER}`, "i") },
  // Round 11 (SEC-11-01): verbs that take the water as their object ("Kids can enter the creek", "Leap across the creek",
  // "Splash around the creek", "Jump the creek").
  { name: "water", re: new RegExp(String.raw`\b(?:enter(?:s|ed|ing)?|leap\w*|jump(?:s|ed|ing)?|hop(?:s|ped|ping)?|splash\w*(?:\s+around)?|wad(?:e|es|ed|ing))\b(?:\s+(?:across|over|around|in|into|through))?\s+(?:the\s+|a\s+|that\s+|this\s+|its\s+|some\s+)?(?:[\w']+\s+)?${INTO}\b${DRY_AFTER}`, "i") },
  // Round 11 (SEC-11-01): the water word FIRST and the verb at the end of the clause ("The creek is shallow enough for kids
  // to stand in", "The ice on the pond is thick enough to walk on", "The pond is fun to splash in").
  // Round 12 (Q-12-01): also "perfect to cool off in", "fun to hop in", "great to dip in".
  { name: "water", re: new RegExp(String.raw`\b${INTO}\b(?:\s+[\w']+){0,8}?\s+(?:stand|walk|wade|play|step|sit|splash|swim|skate|slide|wander|run|cross|float|soak|go|get|cool|hop|jump|dip|dunk|dive|lie|lay|wash|rinse)\w*(?:\s+(?:off|down|around|about|right))?\s+(?:in|on|across|into|through)(?:\s+(?:it|them|there))?\s*(?:[.,;:!?]|$)`, "i") },
  { name: "water", re: /\b(?:shallow|thick|solid|strong|safe|clean|calm|warm|cool|low|frozen)\s+enough\b(?:\s+[\w']+){0,3}?\s+to\s+(?:stand|walk|wade|play|step|sit|splash|swim|skate|slide|cross|drink|enter|get in|go in|jump|hop|float|soak)\b/i },
  // Round 11 (SEC-11-01): places that flood fast or can trap a child.
  { name: "water", re: /\b(?:storm ?drains?|drains?|drain ?pipes?|drainage (?:ditch(?:es)?|pipes?|channels?)|ditch(?:es)?|culverts?|spillways?|sewers?|outfalls?|manholes?|storm grates?)\b/i },
  // Round 12: pipes and tunnels (not the playground's).
  { name: "water", re: /\b(?:crawl|explore|climb|go|peek|look|walk|play|hide|reach|squeeze|wander|venture|run)\w*\b(?:\s+[\w']+){0,3}?\s+(?:in|into|inside|through|under)\s+(?:the\s+|a\s+|that\s+|this\s+|an\s+)?(?:(?!playground\b|slide\b|play\b)[\w']+\s+)?(?:pipes?|tunnels?)\b/i },
  // A body part in the water ("their feet in the pond", "toes in the creek").
  { name: "water", re: new RegExp(String.raw`\b(?:feet|foot|toes?|hands?|legs?|fingers?|heads?|faces?|boots|shoes|bodies|body)\s+(?:in|into|under)\s+(?:the\s+|a\s+|some\s+)?(?:[\w']+\s+)?${INTO}\b${DRY_AFTER}`, "i") },
  // Words that only mean getting wet or handling water life.
  { name: "water", re: /\b(barefoot\w*|bare feet|water shoes|swim ?suits?|bathing suits?|towels? for the (?:creek|pond|lake|river|water)|creek ?beds?|stream ?beds?|river ?beds?|fishing|fish(?:ing)? (?:poles?|rods?|lines?|hooks?)|fish for|bait|nets?|scoop\w*|tadpoles?|crawdads?|crayfish|minnows?|thin ice|on the ice|frozen (?:creek|stream|pond|lake|river|water|puddle)s?)\b/i },
  { name: "water", re: new RegExp(String.raw`\b(?:go|get|climb|head|walk|run|scramble)\w*\s+down\s+(?:to|into)\s+(?:the\s+)?(?:${INTO}|water'?s edge|banks?|shores?|edge)\b|\blean\w*\s+(?:over|out)\b|\b(?:sit|stand|play|lean|wait)\w*\s+(?:at|on|by)\s+(?:the\s+)?(?:very\s+)?(?:edge|water's edge|water’s edge)\b`, "i") },
  // Throwing things in or at wildlife ("Throw bread to the ducks", "Toss rocks into the pond", "Skip stones on the lake").
  { name: "wildlife", re: /\b(?:throw|toss|skip|chuck|fling|drop)\w*\b(?:\s+[\w']+){0,4}?\s+(?:bread|crumbs?|food|seeds?|snacks?|crackers?|chips|popcorn|rocks?|stones?|pebbles?|sticks?|things|anything)\b/i },
  { name: "wildlife", re: new RegExp(String.raw`\b(?:bread|crumbs?|crackers?|popcorn|bird ?seed|duck food)\b.*\b${ANIMALS}\b|\b${ANIMALS}\b.*\b(?:bread|crumbs?|crackers?|popcorn|bird ?seed|duck food)\b`, "i") },
  // Round 11 (SEC-11-01): food meant for wildlife ("Bring a snack for the geese", "Pack food for the ducks").
  { name: "wildlife", re: new RegExp(String.raw`\b(?:snacks?|food|bread|treats?|seeds?|crackers?|leftovers?|lunch|scraps?|nuts|peanuts|corn|lettuce|grapes|apples?)\b\s+(?:for|to give|to share with|to toss to)\s+(?:the\s+|a\s+|some\s+|any\s+)?(?:[\w']+\s+)?${ANIMALS}\b`, "i") },
  // Hugging anything when the tip names a hazard ("Hug the big tree with poison ivy on it").
  { name: "hazard", re: new RegExp(String.raw`\bhug\w*\b.*\b${HAZARDS}\b`, "i") },
  // Contact or chasing with a hazard or an animal, in any order ("Smell the poison ivy", "Follow the snake", "Poke the snake hole").
  { name: "hazard", re: new RegExp(String.raw`\b${RISK_VERBS}\b(?:\s+[\w'’]+){0,3}?\s+${ANIMAL_NOT_PLACE}`, "i") },
  { name: "hazard", re: new RegExp(String.raw`\b${SEEK_VERBS}\b(?:\s+[\w'’]+){0,3}?\s+${HAZARDS}\b`, "i") },
  { name: "hazard", re: new RegExp(String.raw`\b${HAZARDS}\b(?:\s+[\w'’]+){0,4}?\s+(?:to\s+)?(?:touch|pick|pull|collect|smell|sniff|follow|chase|poke|catch|hold|pet|feed|grab|taste|eat|lick|play with)\b`, "i") },
  // Climbing rocks, trees, banks, walls or anything by the water.
  { name: "climb", re: new RegExp(String.raw`\bclimb\w*\b(?:\s+(?:on|up|onto|over|down))?(?:\s+(?:the|a|those|these|some|big)\b)?(?:\s+[\w']+)?\s+(?:rocks?|boulders?|stones?|trees?|branch(?:es)?|cliffs?|bluffs?|ledges?|walls?|fences?|dams?|banks?|railings?|rails?|logs?|spillways?)\b|\bclimb\w*\b.*\b${INTO}\b|\b${NAT}\b.*\bclimb\w*\b`, "i") },
  // Looking or reaching under things where snakes and stinging bugs hide.
  { name: "hazard", re: /\b(?:under|beneath|underneath)\s+(?:the\s+|a\s+|any\s+|some\s+)?(?:big\s+|old\s+|fallen\s+|loose\s+)?(?:rocks?|stones?|logs?|boards?|leaves|leaf piles?|bark|brush|bushes)\b/i },
  // Keeping or collecting things from the park ("Bring a jar", "collect caterpillars"); gathering the group is fine.
  { name: "collect", re: /\b(?:jars?|buckets?|bug catchers?|bug boxes?|specimen\w*)\b|\b(?:collect|gather)\w*\b(?!\s+(?:your\s+|the\s+|all\s+|any\s+)?(?:trash|litter|garbage|wrappers?|rubbish|belongings|things|stuff|bags?|gear|group|kids|everyone|together|at|in|around|by|near|for|before|after)\b)/i },
  // Smelling, tasting or licking anything out there.
  { name: "hazard", re: /\b(?:smell|sniff|taste|lick|chew)\w*\b/i },

  // ---- Round 12 (Q-12-01): same-tip rules (a risky act + a hazard anywhere in the tip) and more wordings. ----
  // Getting wet in natural water, in any wording ("No trip is complete without a dip in the pond", "so hop in").
  {
    name: "water",
    re: /\b(?:swim\w*|wad(?:e|es|ed|ing)|dip(?:s|ped|ping)?|dunk\w*|div(?:e|es|ed|ing)|plung\w*|bath(?:e|es|ed|ing)|soak\w*|splash\w*(?!\s+pads?)|(?:get|gets|getting|got)\s+(?:[\w']+\s+){0,2}?wet|wet\s+(?:their|your|his|her|its|the|little|tiny)?\s*(?:feet|toes|hands|legs|shoes|boots|fingers)|barefoot\w*|bare feet|toes|feet in|cool\w*\s+(?:off|down)\s+(?:in|at|with)\b|(?:hop|jump|dive|dip|go|get|climb|step|wade|walk|splash|wander|run|slide|leap|plunge)\w*\s+(?:right\s+|on\s+|straight\s+)?in(?:\s+(?:it|there))?\s*(?:[.,;:!?]|$)|(?:shoes|socks|boots)\s+off|dry\s+off|towels?|(?:change|spare|dry)\s+(?:of\s+)?clothes|off\s+(?:your|their)\s+(?:shoes|socks|boots)|(?:from|on|down|off|along|up)\s+the\s+(?:[\w'-]+\s+)?(?:banks?|embankments?|slopes?)|float\w*|drop\w*\s+a\s+line|cast\w*|reel\w*|go\s+fishing|(?:and|to|can|let's)\s+fish\b(?!\s+(?:swim|are|in\s+the)))/i,
    need: [WET_PLACE],
  },
  // On the ice ("Test the ice on the pond", "The pond is frozen, so kids can slide across it").
  { name: "water", re: /\b(?:test|try|check|break|crack|stomp|poke|tap|kick|slid|skat|skid)\w*\b(?:\s+[\w']+){0,3}?\s+(?:the\s+)?ice\b(?!\s+(?:cream|packs?|chests?|coolers?|water))/i },
  { name: "water", re: /\b(?:walk|slid|skat|stand|play|step|run|ventur|cross|stomp|jump|hop|test|skid)\w*\b|\b(?:go|head)\w*\s+out\b/i, need: [ICE_IN, WET_PLACE] },
  // Rocks, logs, railings, ledges and edges over water ("Sit on the rocks at the edge of the creek").
  { name: "climb", re: new RegExp(String.raw`\b${PERCH}(?:railings?|rails?|handrails?|guard ?rails?|ledges?|dams?|spillways?|pipes?|culverts?|parapets?|edge of the (?:dock|pier|bridge|dam|wall)|end of the (?:dock|pier))\b`, "i") },
  { name: "climb", re: new RegExp(String.raw`\b${PERCH}(?:rocks?|boulders?|stones?|logs?|walls?|edges?|banks?|stepping[- ]stones?|fallen trees?|trees?|branch(?:es)?|ice)\b`, "i"), need: [WET_PLACE] },
  { name: "climb", re: /\b(?:top|edge|ledge|rim|lip)\s+of\s+the\s+(?:dam|spillway|wall|cliff|bluff|culvert|waterfall|falls)\b/i },
  { name: "climb", re: /\bdangl\w*\b(?:\s+[\w']+){0,3}?\s+(?:over|off|from|in|into|above)\b/i },
  { name: "climb", re: /\b(?:jump|leap|dive|hop|flip|cannonball)\w*\s+(?:off|from)\s+(?:the\s+|a\s+)?(?:[\w']+\s+)?(?:bridges?|docks?|piers?|rocks?|ledges?|walls?|dams?|banks?|logs?|trees?|edge|boulders?|cliffs?|bluffs?)\b/i },
  // Feeding wildlife, in any wording ("Share your snacks with the geese", "Give the ducks some of your sandwich").
  {
    name: "wildlife",
    re: /\b(?:shar(?:e|es|ed|ing)|giv(?:e|es|ing)|gave|offer\w*|toss\w*|throw\w*|threw|hand(?:s|ed|ing)?\s+(?:out|over)|feed\w*|fed|scatter\w*|sprinkl\w*|spare|put\s+out|set\s+out|lay\s+out|leav(?:e|es|ing)\s+(?:out|some|a few)|drop\w*)\b/i,
    need: [ANIMAL_IN, FOOD_IN],
  },
  { name: "wildlife", re: /\b(?:hand[- ]?feed\w*|(?:eat|nibble|take|peck)\w*\s+(?:[\w']+\s+)?(?:from|out of)\s+(?:your|their|a|the|his|her)\s+(?:hands?|palms?|fingers?))\b/i },
  // Posing with, waving at or getting close to a dangerous animal or plant ("Take a selfie next to the copperhead").
  {
    name: "hazard",
    re: /\b(?:selfies?|photos?|pictures?|pics?|snapshots?|pos(?:e|es|ed|ing)|wav(?:e|es|ed|ing)|say\w*\s+(?:hi|hello)|visit\w*|meet\w*|up close|close[- ]?ups?|closer|close look|how close|(?:get|go|come|move|walk|stand|sit|lean|step|creep|sneak|crouch|kneel|reach)\w*\s+(?:[\w']+\s+)?(?:close|near|next to|beside|right by|right up|up to)|next to|beside|right by|right up to)\b/i,
    need: [DANGER_IN],
  },
  { name: "hazard", re: new RegExp(String.raw`\b(?:sit|stand|play|picnic|lie|lay|rest|spread|camp|wait|hang out|seat|blanket|chairs?|eat|nap)\w*\b(?:\s+[\w']+){0,5}?\s+(?:near|by|close to|next to|beside|around|under|on|in)\s+(?:the\s+|a\s+|those\s+|any\s+|that\s+|some\s+)?(?:[\w']+\s+)?${DANGER}\b`, "i") },
  { name: "hazard", re: new RegExp(String.raw`\b(?:selfies?|photos?|pictures?|pics?|pos(?:e|es|ed|ing))\s+(?:[\w']+\s+){0,2}?(?:with|next to|beside|holding|hugging|petting|by)\s+(?:the\s+|a\s+|an\s+|some\s+)?(?:[\w']+\s+)?${ANIMALS}\b`, "i") },
  // Touching, carrying or handling an animal ("Pat the turtle's shell", "Gently stroke the fuzzy caterpillar").
  { name: "hazard", re: new RegExp(String.raw`\b(?:help\w*|rescu\w*|mov(?:e|es|ed|ing)|relocat\w*|carr(?:y|ies|ied|ying)|wrangl\w*|strok\w*|pat|pats|patt\w*|tickl\w*|cuddl\w*|kiss\w*|boop\w*|nudg\w*|handl\w*|ride|riding|rub\w*|squeez\w*)\s+(?:the\s+|a\s+|an\s+|that\s+|this\s+|any\s+|those\s+|these\s+|some\s+)?(?:[\w'’-]+\s+){0,2}?${ANIMAL_NOT_PLACE}`, "i") },
  { name: "hazard", re: /\b(?:crawl|walk|climb|sit|perch|land|ride|hop|slither|scurr(?:y|ies|ied|ying)|run|wander)\w*\s+(?:on|onto|up|over|across|into)\s+(?:you\b|your\b(?!\s+own)|their\b(?!\s+own)|the\s+kids?\b)/i, need: [ANIMAL_IN] },
  // Eating wild plants ("Try the wild onions", "The mulberries by the trail are sweet").
  { name: "eat", re: new RegExp(String.raw`\b(?:eat|eats|eating|ate|tast\w*|try(?!\s+to\b)|tries(?!\s+to\b)|tried(?!\s+to\b)|trying(?!\s+to\b)|nibbl\w*|chew\w*|snack\w*\s+on|munch\w*|suck\w*|lick\w*|bit(?:e|es|ing)\s+(?:into|on)|sampl\w*|swallow\w*)\b(?:\s+[\w']+){0,3}?\s+(?:wild\b|${WILD_FOOD})`, "i") },
  { name: "eat", re: /\b(?:wild\s+\w+|\w*berr(?:y|ies)|mushrooms?|fung(?:us|i)|toadstools?|acorns?|nectar|honeysuckle|clover|leaves|flowers?|petals?|weeds?|pecans?|persimmons?|plums?|onions?|dandelions?|prickly pears?)(?:\s+[\w']+){0,5}?\s+(?:tasty|sweet|delicious|yummy|juicy|edible|ripe|safe to eat|good to eat|fine to eat|ok to eat|okay to eat|treat)\b/i },
  { name: "eat", re: /\b(?:wild\s+\w+|\w*berr(?:y|ies)|mushrooms?|fung(?:us|i)|toadstools?|acorns?|nectar|honeysuckle|clover|pecans?|persimmons?|plums?|onions?|dandelions?|prickly pears?)(?:\s+[\w']+){0,4}?\s+(?:to\s+)?(?:snack|eat|munch|nibble|taste|chew|try)\w*\b/i },
  // Kids away from their grown-up ("Let the kids explore on their own", "Split up to find the clues faster").
  {
    name: "alone",
    re: /\b(?:on\s+(?:their|your|his|her)\s+own|by\s+(?:themselves|yourself|yourselves|himself|herself)|alone|unsupervised|unattended|without\s+(?:a\s+|an\s+|your\s+|their\s+|any\s+)?(?:grown[- ]?ups?|adults?|parents?|supervision|chaperones?)|without\s+(?:you|them|us|me)\b|roam\w*|(?:while|when)\s+you\s+(?:relax|rest|read|nap|shop|chat)\w*|(?:stay|wait|play|remain)\w*\s+(?:[\w']+\s+){0,4}?(?:while|when)\s+you\b|split\w*\s+up|wander\w*\s+off|(?:run|race|go|goes|went|walk|ride|bike|head|dash)\w*\s+(?:on\s+)?ahead\b(?!\s+and\b)|out\s+of\s+(?:sight|view|earshot)|no\s+(?:grown[- ]?ups?|adults?|supervision)\s+needed|(?:leav\w*|left|drop\w*|send\w*|sent)\s+(?:the\s+|your\s+)?(?:kids?|children|child|little\s+ones|toddlers?)\b(?!['’])(?!\s+(?:a|an|some|the)\b))/i,
  },
];

/** Negation words ("Don't let the kids walk on the ice", "Stay away from the mounds"). */
/*
 * Round 12 (Q-12-01): "without", "instead of", "rather than" and "skip" are no longer negations: "No trip is complete
 * WITHOUT a walk in the creek" and "Don't SKIP a walk in the creek" mean the opposite.
 */
const NEGATION = String.raw`(?:don't|dont|do not|never|no|not|avoid\w*|stay (?:off|out|away|clear|back)(?: of| from)?|keep (?:off|out|away|clear|back|[\w']+ (?:off|out|away|clear|back))(?: of| from)?|away from|out of|nobody|no one|steer clear(?: of)?|beware(?: of)?)`;
const NEGATION_WORD = new RegExp(String.raw`\b${NEGATION}`, "gi");
/**
 * Round 11 (SEC-11-01): the only words that may stand between a negation and the risky words it governs ("Don't LET THE
 * KIDS walk ..."). Any other word in between means the negation is about something else ("Kids who are not TIRED CAN
 * cool off in the creek"), so the rule still applies.
 */
const NEG_FILLER = String.raw`(?:let|lets|letting|allow|allowing|have|make|the|a|an|any|your|our|their|kids?|children|child|little\s+ones?|ones?|toddlers?|anyone|anybody|someone|them|you|ever|even|try|trying|to|be|by|near|around|too|close|far|into|onto|on|in|of|from|across|over|through|out|off|ahead|alone|up|away|leave|leaving|left|${ENTRY_VERBS}|${RISK_VERBS})`;
const NEGATED_BEFORE = new RegExp(String.raw`\b${NEGATION}(?:\s+${NEG_FILLER}){0,6}$`, "i");

/** "Don't forget", "never mind": not a negation of what follows. */
// Round 12: also "don't skip", "never pass up", "never say no to", "no trip is complete ...".
const NOT_A_NEGATION = /\b(?:don't|dont|do not|never)\s+(?:forget|worry|miss|mind|hesitate|wait|be afraid|be shy|skip|pass up)\b|\bsay\w*\s+no\b|\bno\s+(?:trip|visit|day|outing|hunt|summer)\b/gi;

/*
 * Round 12 (Q-12-03): wordings that only look risky, rewritten before the checks run. Each is narrow: the risky
 * wordings next to them still drop ("Grab a snack for the squirrels" becomes "choose a snack for the squirrels", which
 * the food rule drops).
 */
const PREP: readonly [RegExp, string][] = [
  // "catch a glimpse of the herons" is looking, not catching.
  [/\bcatch(?:es|ing)?\s+(?:a\s+)?(?:glimpse|sight|view)\s+of\b/gi, "see"],
  // "Watch the ducks swim on the pond": the ducks swim, not the kids.
  [new RegExp(String.raw`\b((?:watch|see|spot|look at|count|observe|enjoy)\w*\s+(?:the\s+|a\s+|some\s+)?(?:[\w']+\s+)?${ANIMALS})\s+(?:swim\w*|paddl\w*|div(?:e|es|ing)|float\w*|splash\w*|wad(?:e|es|ing))\b`, "gi"), "$1 move"],
  // "Feed the kids lunch at the shelter", "Grab a seat on a bench".
  [/\bfeed(?:ing)?\s+(?:the\s+|your\s+)?(kids|children|family|everyone|group|little ones|crew)\b(?!['’])/gi, "serve the $1"],
  [/\bgrab\s+(?:a|an|some|your)\s+(seat|bench|spot|table|snack|bite|lunch|drink|water|break|photo|picture|map|pencil|jacket|hat)\b/gi, "choose a $1"],
];
/** The tip as the checks read it (curly quotes straightened, PREP applied). */
function prepTip(tip: string): string {
  let t = tip.replace(/[’‘]/g, "'");
  for (const [re, to] of PREP) t = t.replace(re, to);
  // "Bring water shoes for the splash pad" (no creek or pond in the tip): shoes for the splash pad.
  if (/\bsplash pads?\b/i.test(t) && !WET_PLACE.test(t)) t = t.replace(/\bwater shoes\b/gi, "shoes").replace(/\b(?:swim ?suits?|bathing suits?)\b/gi, "clothes");
  return t;
}

/** The pair rule a tip breaks ("water", "drink", "hazard"...), or null. */
export function riskyTip(tip: string): string | null {
  const text = prepTip(tip);
  for (const rule of PAIR_RULES) {
    const re = new RegExp(rule.re.source, `${rule.re.flags.replace("g", "")}g`);
    for (const m of text.matchAll(re)) {
      // The clause the match is in: after the last , ; : . ! ? dash, or "and/then/so/but/or" before it.
      const before = text.slice(0, m.index ?? 0);
      const cut = Math.max(...[...before.matchAll(/[,;:.!?—]|\s-\s|\b(?:and|then|so|but|or|while)\b/gi)].map((c) => (c.index ?? 0) + c[0].length), 0);
      // Round 11 (SEC-11-01): the negation must govern the match: right before it, or with only NEG_FILLER words between.
      const clause = before.slice(cut).replace(NOT_A_NEGATION, " ~ ").trimEnd();
      // Round 12: two negations cancel out ("Never avoid ...", "Don't stay out of ...").
      if (NEGATED_BEFORE.test(clause) && [...clause.matchAll(NEGATION_WORD)].length < 2) continue;
      // Round 12: a same-tip rule counts only when its other words are in the tip too.
      if (rule.need && !rule.need.every((n) => n.test(text))) continue;
      return rule.name;
    }
  }
  return null;
}

/*
 * Judge round 11 (T2): the facts only ever say what is NOT ON THE PARK MAP ("No restroom on the park map"), and a
 * missing map entry is not proof that a park has none. A tip that turns that into "there are no restrooms" is rewritten
 * to keep the map wording ("... the park map shows no restrooms"); one that would get too long is replaced by the plain
 * map line. Never a new claim: only the absence wording changes.
 */
const AMENITY = String.raw`(?:public\s+)?(?:restrooms?|bathrooms?|toilets?|potty|loos?|(?:drinking\s+|water\s+)?fountains?|drinking\s+water|water\s+refill\s+stations?|refill\s+stations?)`;
const WHERE = String.raw`(?:\s+(?:here|there|at\s+(?:the|this)\s+park|in\s+(?:the|this)\s+park|on\s+site|onsite|nearby|anywhere|available|in\s+sight))?`;
/** Round 12 (Q-12-02): a rewrite is skipped where the same clause already talks about the map ("The map shows there are no ..."). */
const NO_MAP_BEFORE = String.raw`(?<!\bmap\b[^.;:!?]*)`;
const NO_MAP_AFTER = String.raw`(?![^.;:!?]*\bmap\b)`;
const ABSENCE_REWRITES: readonly [RegExp, string][] = [
  [new RegExp(String.raw`${NO_MAP_BEFORE}\b(?:there\s+(?:are|is|will\s+be)|there's|there're|you\s+won't\s+find|you\s+will\s+not\s+find)\s+(?:no|not\s+any|any)\s+(${AMENITY})${WHERE}${NO_MAP_AFTER}`, "gi"), "the park map shows no $1"],
  // Round 12: "There aren't any restrooms", "There isn't a drinking fountain", "There is not a water fountain".
  [new RegExp(String.raw`${NO_MAP_BEFORE}\bthere\s+(?:aren't|are\s+not|isn't|is\s+not|won't\s+be|will\s+not\s+be)\s+(?:any\s+|a\s+|an\s+)?(${AMENITY})${WHERE}${NO_MAP_AFTER}`, "gi"), "the park map shows no $1"],
  [new RegExp(String.raw`${NO_MAP_BEFORE}\b(?:the|this)\s+park\s+(?:has|offers|got)\s+no\s+(${AMENITY})${WHERE}${NO_MAP_AFTER}`, "gi"), "the park map shows no $1"],
  [new RegExp(String.raw`${NO_MAP_BEFORE}\b(?:the|this)\s+park\s+(?:doesn't|does\s+not|lacks|has\s+not\s+got)\s+(?:have\s+)?(?:any\s+|a\s+)?(${AMENITY})${WHERE}${NO_MAP_AFTER}`, "gi"), "the park map shows no $1"],
  [new RegExp(String.raw`${NO_MAP_BEFORE}\b(${AMENITY})\s+(?:aren't|are\s+not|isn't|is\s+not)\s+(?:available|here|there|provided|on\s+site)${NO_MAP_AFTER}`, "gi"), "the park map shows no $1"],
  // Round 12: "Restrooms: none on site".
  [new RegExp(String.raw`${NO_MAP_BEFORE}\b(${AMENITY})\s*:\s*(?:none|nothing|zero)(?:\s+(?:on\s+site|onsite|here|there|nearby|available|at\s+(?:the|this)\s+park|in\s+(?:the|this)\s+park))?${NO_MAP_AFTER}`, "gi"), "the park map shows no $1"],
  // Round 12: "Without restrooms nearby, go before you come".
  [new RegExp(String.raw`${NO_MAP_BEFORE}\bwithout\s+(?:any\s+)?(${AMENITY})${WHERE}${NO_MAP_AFTER}`, "gi"), "with no $1 on the park map"],
  [new RegExp(String.raw`${NO_MAP_BEFORE}(?<!\bshows\s+)\bno\s+(${AMENITY})${WHERE}(?!\s+on\s+the\s+(?:park\s+)?map)${NO_MAP_AFTER}`, "gi"), "no $1 on the park map"],
];

/** Absence tips that would be too long after the rewrite: the plain map line (each well under TIP_MAX). */
const ABSENCE_SHORT = {
  restroom: "The park map shows no restrooms; check before you go",
  fountain: "The park map shows no drinking fountain; bring water from home",
} as const;

/**
 * The tip with "there are no restrooms/fountains" turned into "the park map shows no ...". Round 12 (Q-12-02): a tip
 * that says "map" somewhere else is rewritten too ("Check the map: there are no restrooms"); only a clause that already
 * talks about the map is left alone.
 */
export function mapAbsenceWording(tip: string): string {
  let out = tip;
  for (const [re, to] of ABSENCE_REWRITES) out = out.replace(re, (_m, what: string) => to.replace("$1", what.toLowerCase()));
  if (out === tip) return tip;
  out = out.charAt(0).toUpperCase() + out.slice(1);
  if (out.length <= TIP_MAX) return out;
  return /restroom|bathroom|toilet|potty|loo/i.test(tip) ? ABSENCE_SHORT.restroom : ABSENCE_SHORT.fountain;
}

/** Words that say a restroom or fountain is missing, shut or broken. */
const ABSENT = new RegExp(String.raw`\bno\s+(?:[\w']+\s+){0,2}?${AMENITY}|\b(?:none|nothing|zero|without|lacks?|lacking|missing|closed|locked|out of order|broken|unavailable|not available|aren't|isn't|nowhere)\b`, "i");
const AMENITY_IN = new RegExp(String.raw`\b${AMENITY}\b`, "i");

/**
 * Round 12 (Q-12-02): true when a tip (after mapAbsenceWording) still says a restroom or fountain is missing, closed
 * or broken without the map wording. The facts can only back "not on the park map", so checkTips drops such a tip.
 */
export function absenceClaim(tip: string): boolean {
  if (!AMENITY_IN.test(tip)) return false;
  const parts = tip.split(/[.;:!?]/);
  if (!/\bmap\b/i.test(tip) && ABSENT.test(tip)) return true;
  return parts.some((p) => AMENITY_IN.test(p) && ABSENT.test(p) && !/\bmap\b/i.test(p));
}

/** A kid's grown-up is the reader on 4-13 passes; on a 13+ pass the reader holds it alone. */
const KID_WORDS = /\b(kids?|kiddos?|child(?:ren)?|little ones?|toddlers?|your young\w*|grown-?ups?)\b/i;

const norm = (s: string) => s.normalize("NFKC").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();

/** Topics the tip talks about. */
export function topicsIn(tip: string): Topic[] {
  return TOPICS.filter((t) => t.re.test(tip));
}

/** Numbers in a text ("88°F" -> 88; "7:01 PM" -> 7, 01; "40%" -> 40). */
const numbersIn = (s: string) => s.match(/\d+/g) ?? [];

export type TipCheck = { kept: TripTip[]; drops: Partial<Record<TipDropReason, number>>; returned: number };

/** Why a tip is unsafe (the first rule it breaks), or null. */
export function unsafeTip(tip: string): "contact" | "handling" | "unsafe" | null {
  if (hasUrlOrMarkup(tip)) return "contact";
  // Round 12 (Q-12-03): the handling and phrase checks read the prepared text ("Feed the kids lunch" is not handling).
  const text = prepTip(tip);
  if (handlingInstruction(text)) return "handling";
  if (UNSAFE.some((re) => re.test(text))) return "unsafe";
  if (riskyTip(tip)) return "unsafe";
  return null;
}

/**
 * Check the model's tips against the facts it was given. Keeps at most MAX_TIPS, in the model's order. `why` is always
 * the code-written text of a real fact.
 */
export function checkTips(drafts: readonly TipDraft[], facts: readonly TipFact[], band: AgeBand): TipCheck {
  const drops: TipCheck["drops"] = {};
  const drop = (r: TipDropReason) => {
    drops[r] = (drops[r] ?? 0) + 1;
  };
  const byId = new Map(facts.map((f) => [f.id, f]));
  const allTags = new Set(facts.flatMap((f) => f.tags));
  const allNumbers = new Set(facts.flatMap((f) => numbersIn(f.text).map((n) => String(Number(n)))));
  const seen = new Set<string>();
  const kept: TripTip[] = [];
  for (const d of drafts) {
    if (typeof d.tip !== "string" || typeof d.factId !== "string" || typeof d.icon !== "string" || !(TIP_ICONS as readonly string[]).includes(d.icon)) {
      drop("shape");
      continue;
    }
    const tip = mapAbsenceWording(norm(d.tip).replace(/\.$/, ""));
    if (tip.length < 3 || tip.length > TIP_MAX) {
      drop("shape");
      continue;
    }
    const cited = byId.get(d.factId);
    if (!cited) {
      drop("unknown_fact");
      continue;
    }
    const unsafe = unsafeTip(tip);
    if (unsafe) {
      drop(unsafe);
      continue;
    }
    // Round 12 (Q-12-02): "Bathrooms are closed" is a claim no fact can back (the facts only know the park map).
    if (absenceClaim(tip)) {
      drop("not_grounded");
      continue;
    }
    if (isAdultBand(band) && KID_WORDS.test(tip)) {
      drop("voice");
      continue;
    }
    if (numbersIn(tip).some((n) => !allNumbers.has(String(Number(n))))) {
      drop("number");
      continue;
    }
    const topics = topicsIn(tip);
    if (topics.some((t) => !t.backedBy.some((tag) => allTags.has(tag)))) {
      drop("not_grounded");
      continue;
    }
    // The why: the cited fact when it backs one of the tip's topics (or the tip names none), else the first fact that does.
    const backs = (f: TipFact) => topics.some((t) => t.backedBy.some((tag) => f.tags.includes(tag)));
    const why = topics.length === 0 || backs(cited) ? cited : facts.find(backs);
    if (!why) {
      drop("not_grounded");
      continue;
    }
    const key = tip.toLowerCase();
    if (seen.has(key)) {
      drop("duplicate");
      continue;
    }
    seen.add(key);
    kept.push({ tip, why: why.text, icon: d.icon as TipIcon });
    if (kept.length >= MAX_TIPS) break;
  }
  return { kept, drops, returned: drafts.length };
}
