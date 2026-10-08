/**
 * Round 9 (SEC-9-01 / Q-9-02): the reviewers' probe lists for the "look, don't touch" check, kept as permanent tests.
 * Security's and quality's bypasses (all must be caught) and their safe sentences (none may be flagged). The replay of
 * every recorded clue, hint and riddle (tests/unit/r8-content.test.tsx) must still flag 0.
 */
import { describe, expect, it } from "vitest";
import { handlingInstruction } from "@/lib/safety/handling";

const CAUGHT = [
  // A clause after a comma.
  "Find the shrub, crush a leaf and smell it.",
  "If you are brave, touch the fuzzy caterpillar.",
  "Look under the oak, pick up an acorn.",
  "When you find the moss, gently squeeze it.",
  // A reader-like subject plus a modal.
  "Kids can catch this frog by the pond.",
  "Explorers should pick a berry from this bush.",
  "Visitors can feed the ducks here.",
  "Everyone can touch the soft bark.",
  // Mouth.
  "Chew a leaf to taste its mint.",
  "Put a berry in your mouth to taste it.",
  "Bite into the wild grape.",
  "Try chewing a blade of grass.",
  // Damage or removal.
  "Snap a twig off this tree.",
  "Pluck a petal from the flower.",
  "Tear a leaf in half to smell it.",
  "Squish the berry to see its purple juice.",
  "Take a leaf home for your collection.",
  "Bring a berry home to show your family.",
  "Take one of the pine cones home.",
  // Body contact.
  "Hug the big oak tree.",
  "Climb the tree to see the nest.",
  "Climb up the low branch for a better look.",
  "Let the caterpillar crawl on your hand.",
  "Place it in your palm and look closely.",
  "Hold out your arm so the butterfly lands on your arm.",
  // Water.
  "Wade into the creek to find the snail.",
  "Reach into the water to feel the stones.",
  "Reach under the log to find the beetle.",
  // Wildlife food.
  "Give the duck some bread.",
  "Give the squirrels a few seeds.",
  "Feed the ducks by the pond.",
  // A find the reader picked.
  "Smell the flower up close by sniffing a petal you picked.",
  "Look at the acorns you collected.",
  // The round-8 forms stay caught.
  "Crush a leaf and smell the lemon scent to confirm this shrub.",
  "Run your fingers along the bark to feel its deep ridges.",
  "Turn over a log to find this beetle.",
  "Can you catch one?",
];

const SAFE = [
  "Look, don't touch.",
  "Spot a bridge with rails to hold on to.",
  "You can hold my railings while you walk.",
  "Catch a glimpse of a hawk.",
  "Find a table to sit and eat.",
  "Find a leaf as big as your hand.",
  "Turn left at the big oak.",
  "Hold your pass up to the sky.",
  "Hold still and listen.",
  "Feel the breeze on the hill.",
  "Pick out the tallest tree.",
  "Watch dogs chase a ball.",
  "Notice a bird that can catch fish.",
  "Its leaves feel like sandpaper.",
  "Find things to climb, slide and swing on.",
  "Snap a photo of the tallest tree.",
  "Hug your grown-up at the top of the hill.",
  "Reach the top of the hill and look around.",
  "Take your trash home with you.",
  "Walk with your pass in your hand.",
  "Find the path you picked at the start.",
  "Climb the steps to the lookout.",
  "Give your grown-up a high five at the bridge.",
  "Take a photo home to remember the heron.",
  "Look up, then find the red leaves.",
  "Spot a place with a roof where people eat.",
  "A touch of red on its wings.",
  "Kids can look for the bench by the pond.",
];

describe("SEC-9-01 / Q-9-02: the widened contact check", () => {
  it.each(CAUGHT)("catches: %s", (t) => {
    expect(handlingInstruction(t)).not.toBeNull();
  });
  it.each(SAFE)("leaves alone: %s", (t) => {
    expect(handlingInstruction(t)).toBeNull();
  });
});
