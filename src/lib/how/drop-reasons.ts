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
  schema: { kind: "always", plain: "The answer is not in the exact shape we asked for (a missing part, or a clue that is too long)." },
  cut_off: { kind: "always", plain: "The clue stops in the middle of a sentence (\"Hunt for a\")." },
  url_or_markup: { kind: "always", plain: "It has a link, an email address or web code in it." },
  unknown_id: { kind: "always", plain: "It points at an item that is not on this park's list." },
  duplicate_id: { kind: "always", plain: "It uses the same item a second time." },
  section_mismatch: { kind: "always", plain: "It puts an item in the wrong section." },
  danger: { kind: "always", plain: "It is about a blocked species, or it names one (for example \"poison ivy\")." },
  not_grounded: { kind: "always", plain: "Its proof quote is not found, word for word, in that item's facts." },
  name_leak: {
    kind: "always",
    plain: "It gives the answer away: a word of the thing's name or scientific name (or a word built on it), or it talks about the name itself (\"a tree with a white name\").",
  },
  name_trait: {
    kind: "preference",
    plain: "It describes the thing with a colour, pattern or size word from its own name (\"white flowers\" for White Morning-glory).",
  },
  mentions_map: { kind: "always", plain: "It says \"map\" on a pass that has no map." },
  out_of_season: {
    kind: "always",
    plain: "It talks about a plant's flowers or fruit when iNaturalist photos from the area don't show them this month.",
  },
  number_not_in_source: { kind: "always", plain: "It has a number that is not in its facts." },
  wrong_count: { kind: "always", plain: "A count that is not the map's real count, or that counts the wrong thing (goals instead of fields)." },
  broken_count: { kind: "always", plain: "A \"how many\" question that gives its own answer away, or that has nothing to count." },
  silent_sound: {
    kind: "always",
    plain: "It asks the child to listen for something that makes no sound (a plant, a butterfly), or whose facts name no sound.",
  },
  filler_only: { kind: "always", plain: "Nothing real was left after the filler opener (\"Quick!\") was taken off." },
  generic_clue: {
    kind: "always",
    plain: "A Wild Find clue with no detail from its own facts (\"a tree with leaves\" fits hundreds of trees), or a proof quote that is only the name.",
  },
  copies_example: { kind: "always", plain: "It copies an example sentence from our instructions to the model." },
  copies_source: { kind: "preference", plain: "It copies 4 or more words in a row from its facts instead of saying it in kid words." },
  repeats_clue: { kind: "low-data", plain: "It is nearly the same as another clue on the pass, or uses the same sentence pattern." },
  repeats_opening: {
    kind: "preference",
    plain: "It starts with a stock phrase (\"Can you find\") or with the same first words as another clue.",
  },
  over_section_max: { kind: "always", plain: "That section already has as many items as the mix allows." },
};
