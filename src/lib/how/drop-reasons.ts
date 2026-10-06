/**
 * Every reason the server's checks can remove a model clue (validate.ts `DROP_REASONS`), in plain words,
 * for the /how-it-works page. Typed as a full Record, so a new drop reason fails the type check until it
 * is explained here too.
 */
import type { DropReason } from "@/lib/ai/validate";

export type DropReasonInfo = {
  /** Plain-words explanation. */
  plain: string;
  /**
   * "always": the clue is removed. "preference": it is only the first to go when a spare can take its
   * place. "low-data": removed, except on a park with little data, where it is a preference.
   */
  kind: "always" | "preference" | "low-data";
};

export const DROP_REASON_INFO: Record<DropReason, DropReasonInfo> = {
  schema: { kind: "always", plain: "The answer isn't in the shape we asked for (a missing part, or a clue that is too long)." },
  cut_off: { kind: "always", plain: "The clue stops mid-sentence (\"Hunt for a\")." },
  url_or_markup: { kind: "always", plain: "It has a link, an email address or web code." },
  unknown_id: { kind: "always", plain: "It points at something not on this park's list." },
  duplicate_id: { kind: "always", plain: "It uses the same find twice." },
  section_mismatch: { kind: "always", plain: "It puts a find in the wrong section." },
  danger: { kind: "always", plain: "It is about, or names, a blocked species (\"poison ivy\")." },
  not_grounded: { kind: "always", plain: "Its proof quote isn't in that find's facts, word for word." },
  name_leak: {
    kind: "always",
    plain: "It gives the answer away: a word of the name or scientific name, the phrase the name is made of (\"a bird with a red tail\" for Red-tailed Hawk), or talk about the name (\"a tree with a white name\").",
  },
  name_trait: { kind: "preference", plain: "It uses a colour, pattern or size word from the thing's own name (\"white flowers\" for White Morning-glory)." },
  mentions_map: { kind: "always", plain: "It says \"map\" on a pass with no map." },
  out_of_season: { kind: "always", plain: "It mentions a plant's flowers or fruit that local iNaturalist photos don't show this month." },
  number_not_in_source: { kind: "always", plain: "It has a number that isn't in its facts." },
  wrong_count: { kind: "always", plain: "Its count isn't the map's real count, or counts the wrong thing (goals instead of fields)." },
  broken_count: {
    kind: "always",
    plain: "A \"how many\" question that gives its answer away or has nothing to count, or a question mixed with a count (\"Which roof has tables? Count 4 of them.\").",
  },
  silent_sound: { kind: "always", plain: "It asks the child to listen for something silent (a plant, a butterfly), or whose facts name no sound." },
  filler_only: { kind: "always", plain: "Nothing real was left once the filler opener (\"Quick!\") was cut." },
  odd_wording: { kind: "always", plain: "It opens with words people don't say (\"Explore for a bug\")." },
  riddle_frame: { kind: "always", plain: "It is a second clue where the thing talks as itself (\"I am ...\"): one is fun, more is a habit." },
  generic_clue: {
    kind: "always",
    plain: "A Wild Find clue with no detail from its facts (\"a tree with leaves\"), or a proof quote that is just the name.",
  },
  copies_example: { kind: "always", plain: "It copies an example sentence from our instructions." },
  copies_source: { kind: "preference", plain: "It copies 4+ words in a row from its facts instead of using kid words." },
  repeats_clue: { kind: "low-data", plain: "It nearly repeats another clue on the pass, or its sentence pattern." },
  repeats_opening: {
    kind: "always",
    plain: "It starts with the same first word as another clue. (A stock start like \"Can you find\" only makes it the first to go when a spare can replace it.)",
  },
  over_section_max: { kind: "always", plain: "Its section already has as many finds as the mix allows." },
};
