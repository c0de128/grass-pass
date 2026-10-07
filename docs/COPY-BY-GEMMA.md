# Site copy drafted by Gemma 4

On 2026-10-06, Kevin asked for the rest of the website copy to be revised with Google's Gemma. This file is the full record: what Gemma was told, what it wrote for each block, what the code check and the review by an AI coding agent (Claude Code) found, and what shipped. No person has reviewed the drafts yet. Kevin's own lines were not sent (list below).

## In short

- **Model:** `gemma-4-31B-it` on DigitalOcean serverless inference, through the app's own model client (`src/lib/model.ts`, strict JSON schema output).
- **Calls:** 19 (batches of 10), 39,228 prompt + 6,075 completion tokens, **$0.0101** at DigitalOcean list prices (logged in `evals/results/SPEND.md`). Failures: none.
- **Blocks sent:** 184.
  - **Accepted** as Gemma wrote them: 77
  - **Edited** (Gemma draft with a small fix by the reviewing AI coding agent, marked "Gemma draft, edited"): 13
  - **Rejected** (old text kept): 76 (1 by the code check, 75 by the AI coding agent review)
  - **Unchanged** (Gemma returned the old text): 18
- **Reviewed by:** Builder G, an AI coding agent (Claude Code), 2026-10-06; no person has reviewed the drafts yet. Decisions and reasons: `docs/copy-by-gemma/review.json`. Raw drafts: `docs/copy-by-gemma/run-2026-10-06T20-43-12-393Z.json`.
- **Test:** `tests/unit/copy-check.test.ts` checks the code check itself, that every block's old text passes its own rules, that every hand edit passes them too, and that every shipped text is really in the code.

## How it works (and how to run it again)

1. `scripts/copy/blocks.mts` lists every block: its id, page, file, role (with a size), character limit, current text, and a FACTS sheet written by hand from the code and eval files (with the constant each fact comes from). `KEEP` lists exact strings that must survive. `{placeholders}` stand for values code fills in.
2. `pnpm copy:gemma` (paid, about 19 calls, about $0.01; capped at 40 calls and $0.05) sends the blocks to Gemma in batches with the system prompt below and asks for `{"drafts": [{"id", "text"}]}` under a strict JSON schema whose `id` can only be the batch's own ids.
3. **Code check** (`scripts/copy/check.mts`) on every draft. A draft is rejected, and the old text stays, when it:
   - is empty or longer than the block's limit;
   - drops or adds a `{placeholder}`;
   - drops any `KEEP` string (and always "No data available" when the old text has it);
   - adds a number (digits, or a number word like "three") not in the old text or FACTS;
   - adds a name (a capitalised word mid-sentence, or one with inner capitals like "iNaturalist") not in the old text, FACTS or these site words: Grass, Pass, AI, OK, I, No, Yes, Print, Tap, Sign, Make, Try;
   - uses a banned word: revolutionary, revolutionize, revolutionise, magic, magical, seamless, seamlessly, cutting-edge, game-changer, game-changing, unleash, effortless, effortlessly, supercharge, ultimate, world-class, best-in-class, groundbreaking, state-of-the-art, next-level, delve, elevate, empower, unlock, harness, guarantee, guaranteed, forever, always free, 100%, perfect, flawless, instantly;
   - has an emoji or markup.
4. **An AI coding agent (Claude Code)** read every draft that passed (no person has reviewed them yet): untrue, garbled, off-tone or weaker drafts are rejected; tiny fixes are allowed and marked. Decisions go in `docs/copy-by-gemma/review.json`; accepted and edited texts are applied by hand in the files named below.
5. `pnpm copy:render` writes this file.

**Correction after the run:** the FACTS sheet sent to Gemma said there were 18 blocked species groups; the real count (`BLOCKED_TAXA.length`) was 17 then, and is 63 since the safety work of the evening of 2026-10-06. The sheet below shows both. No shipped text was affected: every block that mentions the count uses the `{blocked}` placeholder, which code fills in.

**Fact fixes after the run (not Gemma):** after the run, main changed the pass builder so a pass makes 1-3 model calls (`MAX_MODEL_CALLS = 3`: one whole retry if the first call fails, refills if too few clues pass). Gemma had been sent the old "one retry" facts. 4 blocks were fixed by hand for that (marked "Fact fix after the rebase" below): two accepted Gemma drafts became "edited", and two kept old lines were corrected. Their FACTS sheets below show the new rule.

**Fact fixes after the self-host measurement (not Gemma, 2026-10-06):** a self-hosted Gemma 4 E2B run on a laptop CPU was measured (`evals/results/2026-10-06-selfhost-notes.md`), so "not measured yet" became untrue. 2 blocks were fixed by hand (marked "Fact fix after the self-host measurement" below): one accepted Gemma draft became "edited", and one kept line was corrected. Their FACTS sheets below show the measured result.

The code check catches new facts, lost facts and hype. It cannot catch a sentence that is true word by word but wrong as a whole: those were caught in step 4 (look for **UNTRUE** below). It also had one false positive: "No one" counted as the number word "one".

## Not sent to Gemma

- **Kevin's own lines:** the home hero (chip "SCREEN-FREE & RE-WILDED", the headline "Family time is back! / powered by AI.", the hero paragraph, "Free for parents."), the problem band (heading, both paragraphs, the two park verdicts), the how-it-works headline "Real park data in. Advanced AI processing. Screen-free adventure out.", the header nav labels, and the lines from his home copy reference that shipped as he wrote them ("Proof in every clue.", "See a real pass, right now.", "Print the pass. Pocket the pencil. Leave the phone.", "Make your first pass free"). Three step titles from his reference were sent by mistake ("Pick a park & age", "Print the page", "Hide the phone"); Gemma's versions were rejected for that reason.
- **Numbers-only and legal text:** eval tables and stat tiles, the privacy table, licences and credits, the report rule, the October box dates, the progress-step labels (they mirror the server's real steps).
- **Folded technical details** on /how-it-works and /about (dense numbers mixed with markup: a rewrite could only lose facts).
- **Files another builder is editing** (`src/lib/ai/**`), and the printed kid pass and its safety lines (sized to fit one page; safety wording is code-owned).

## The system prompt (word for word)

```text
You are the copy editor for Grass Pass, a free website for parents. A parent picks a local park and a kid's age; the site prints a one-page scavenger hunt written from that park's real data. The phone stays home.

Rewrite each block of website copy you are given in this voice:
- Modern and conversational, like a friendly parent talking to another parent.
- Light humor and relatable parenting moments are welcome where the role allows (lost shoes, "are we there yet", snack bribes), but never at a kid's expense, and never in safety or error lines.
- Short, scannable lines. Plain words a busy parent reads in one glance. Active voice. Contractions are fine.
- Say "AI" honestly and plainly when the block is about the AI: the AI writes, code checks. Never oversell it.
- Sentence case (not Title Case). No emoji, no hashtags, no markdown, no HTML.

These lines were written by the owner, Kevin, and show the voice (do not copy them, match their feel):
- "Family time is back! powered by AI."
- "Grass Pass turns your local park into an interactive adventure. Our AI analyzes real-world maps and recent wildlife sightings to craft a custom scavenger hunt in seconds. Just hit print, grab a pencil, and head outside - no screens required."
- "Why "Find a pinecone" fails."
- "Generic scavenger hunts fail because parks aren't generic. A manicured city park has basketball hoops; a rugged nature preserve has butterflies."
- "Real park data in. Advanced AI processing. Screen-free adventure out."
- "Print the pass. Pocket the pencil. Leave the phone."

HARD RULES (a draft that breaks one is thrown away automatically):
1. Keep every fact in the block's FACTS. Keep every string in KEEP exactly as written (same letters, numbers, capitals and punctuation inside it).
2. Invent nothing: no new numbers or number words, no new names of places, people, companies or products, no new features, no users, no quotes, no reviews, no promises ("always", "forever", "guaranteed", "instantly").
3. Keep every {placeholder} exactly once, spelled the same, with its braces. Code fills it in later.
4. Stay within MAX_CHARS characters and fit the ROLE (word counts, what it starts or ends with).
5. Never use these words: revolutionary, revolutionize, revolutionise, magic, magical, seamless, seamlessly, cutting-edge, game-changer, game-changing, unleash, effortless, effortlessly, supercharge, ultimate, world-class, best-in-class, groundbreaking, state-of-the-art, next-level, delve, elevate, empower, unlock, harness, guarantee, guaranteed, forever, always free, 100%, perfect, flawless, instantly.
6. Keep the meaning of "No data available" lines, safety lines, privacy facts and limits. Those can be friendlier, never vaguer.
7. If the current text is already as good as you can make it, return it unchanged.

Answer with JSON only: {"drafts": [{"id": "<block id>", "text": "<your rewrite>"}]}, one entry per block, same ids, same order.
```

Each batch's user message is `Rewrite these N blocks.` followed by the blocks as JSON: `id`, `page`, `ROLE`, `MAX_CHARS`, `CURRENT`, `FACTS`, `KEEP` (see `scripts/copy/prompt.mts`).

## Every block

### / (home)

#### `home.how.link`: rejected

`src/components/home/HowItWorks.tsx:55` · link under the How it works headline, to the long explainer page; 12 words or fewer · max 80 characters

- **Old:** The full story for curious grown-ups: the data, the AI and every check
- **Gemma:** For the curious: how the data, AI and checks work.
- **Code check:** passed
- **Shipped:** The full story for curious grown-ups: the data, the AI and every check
- **Why:** Drops 'grown-ups' (who the page is for) and the voice; the current line is better.
- **FACTS:** The linked page (/how-it-works) explains the data sources, what the AI does, and every check code runs.

#### `home.how.s1.title`: rejected

`src/components/home/HowItWorks.tsx:13` · step 1 card title, 5 words or fewer · max 30 characters

- **Old:** Pick a park & age
- **Gemma:** Pick a park and age
- **Code check:** passed
- **Shipped:** Pick a park & age
- **Why:** Kevin's own words (his home copy reference); kept.
- **FACTS:** Step 1: the parent picks a park and the kid's age band.

#### `home.how.s1.body`: rejected

`src/components/home/HowItWorks.tsx:14` · step 1 card body, 2 short sentences · max 170 characters

- **Old:** Type a town, ZIP or park name, or tap Use my location. Then pick 4–6, 6–10 or 10–13: it sets how many clues and how hard.
- **Gemma:** Search by town, ZIP, park name, or tap Use my location. Pick 4–6, 6–10 or 10–13 to set the clue count and difficulty.
- **Code check:** passed
- **Shipped:** Type a town, ZIP or park name, or tap Use my location. Then pick 4–6, 6–10 or 10–13: it sets how many clues and how hard.
- **Why:** 'clue count and difficulty' is stiffer than 'how many clues and how hard'.
- **FACTS:** Search by town, ZIP or park name, or the "Use my location" button. / Age bands are exactly 4-6, 6-10 and 10-13 (AGE_BAND_INFO). / The age band sets how many finds (6, 8 or 8) and how hard the words are. · KEEP: "Use my location", "4–6", "6–10", "10–13"

#### `home.how.s2.title`: unchanged

`src/components/home/HowItWorks.tsx:18` · step 2 card title, 5 words or fewer; must say AI · max 30 characters

- **Old:** AI builds the hunt
- **Gemma:** AI builds the hunt
- **Code check:** passed
- **Shipped:** AI builds the hunt
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** Step 2: the AI model picks the finds and writes the clues; code checks them. · KEEP: "AI"

#### `home.how.s2.body`: rejected

`src/components/home/HowItWorks.tsx:19` · step 2 card body, 3-4 short sentences · max 260 characters

- **Old:** Gemma writes, code checks. Gemma 4 picks a fair mix from the park’s real map and 14 days of nearby sightings, then writes the clues. Code checks each one against its source. Usually 10–30 seconds.
- **Gemma:** Gemma 4 uses real maps and sightings from the last 14 days to write the clues. Code checks every find against its source. It usually takes 10–30 seconds.
- **Code check:** passed
- **Shipped:** Gemma writes, code checks. Gemma 4 picks a fair mix from the park’s real map and 14 days of nearby sightings, then writes the clues. Code checks each one against its source. Usually 10–30 seconds, up to about a minute and a half on a slow evening.
- **Why:** Drops 'Gemma writes, code checks.' (Kevin's line, corrected from his reference) and 'a fair mix'. Fact fix (RULES-7-06, Builder AD, not Gemma): the shipped line now adds the measured upper bound, 'up to about a minute and a half on a slow evening' (PASS_WAIT_COPY, README); 'Gemma writes, code checks.' is untouched.
- **FACTS:** The AI model is Gemma 4 (gemma-4-31B-it), Google's open-weight model (Apache-2.0), run on DigitalOcean serverless inference in the US. / It works from the park's real OpenStreetMap map and the last 14 days of nearby iNaturalist wildlife sightings. / Code checks every clue against its source and removes any that fail; the model never decides what is safe. / A new pass usually takes 10-30 seconds (PASS_WAIT_COPY), up to about a minute and a half when the free map websites are slow. · KEEP: "Gemma 4", "14 days", "10–30 seconds"

#### `home.how.s3.title`: rejected

`src/components/home/HowItWorks.tsx:24` · step 3 card title, 5 words or fewer · max 30 characters

- **Old:** Print the page
- **Gemma:** Print your page
- **Code check:** passed
- **Shipped:** Print the page
- **Why:** Kevin's own words (his home copy reference); kept.
- **FACTS:** Step 3: print the one page.

#### `home.how.s3.body`: rejected

`src/components/home/HowItWorks.tsx:25` · step 3 card body, 1-2 short sentences · max 170 characters

- **Old:** One black-and-white Letter page: the kid’s pass on top, a tear line, and a grown-up stub with the answers and sources.
- **Gemma:** You get one black-and-white Letter page. The kid's pass is on top, with a tear line and a grown-up answer stub at the bottom.
- **Code check:** passed
- **Shipped:** One black-and-white Letter page: the kid’s pass on top, a tear line, and a grown-up stub with the answers and sources.
- **Why:** Drops 'sources' from what the stub carries.
- **FACTS:** The pass is one black-and-white US Letter page. / Top: the kid's pass. Then a tear line. Bottom: the grown-up's stub with the answers and sources. · KEEP: "Letter"

#### `home.how.s4.title`: rejected

`src/components/home/HowItWorks.tsx:29` · step 4 card title, 5 words or fewer · max 30 characters

- **Old:** Hide the phone
- **Gemma:** Ditch the phone
- **Code check:** passed
- **Shipped:** Hide the phone
- **Why:** Kevin's own words (his home copy reference); kept.
- **FACTS:** Step 4: the phone goes away; the hunt is on paper.

#### `home.how.s4.body`: edited

`src/components/home/HowItWorks.tsx:30` · step 4 card body, 1-2 short sentences, light humor welcome · max 150 characters

- **Old:** Phone away. Your kid ticks off finds with a pencil; you keep the stub, in case anyone needs a hint.
- **Gemma:** Phone stays home. Kids use a pencil to tick off finds while you keep the stub for hints (and sanity).
- **Code check:** passed
- **Shipped:** Phone away. Kids tick off finds with a pencil while you keep the stub for hints (and sanity). _(Gemma draft, edited)_
- **Why:** Gemma draft, edited: 'Phone stays home' changed back to 'Phone away' (the card says hide the phone, and grown-ups may carry one).
- **FACTS:** The kid ticks boxes with a pencil. / The grown-up keeps the stub (answers), useful for hints.

#### `home.pass.sub`: rejected

`src/components/home/PassAnatomy.tsx:23` · subhead under "Proof in every clue.", 2 sentences, one light joke allowed · max 170 characters

- **Old:** Every clue comes from a real, dated source, listed on the grown-up's stub. So nobody spends 40 minutes hunting for a heron that flew off in 2019.
- **Gemma:** Every clue comes from a real, dated source listed on your stub. No one spends 40 minutes hunting for a heron that flew away in 2019.
- **Code check:** rejected (new number word(s) not in FACTS: one)
- **Shipped:** Every clue comes from a real, dated source, listed on the grown-up's stub. So nobody spends 40 minutes hunting for a heron that flew off in 2019.
- **Why:** Code check: new number word(s) not in FACTS: one. Rejected by the code check ('No one' counted as a number word: a false positive), so the current text stays.
- **FACTS:** Every clue comes from a real, dated source. / The sources are listed on the grown-up's stub. / The heron joke is Kevin's: no real heron, it is humor.

#### `home.pass.wild.body`: accepted

`src/components/home/PassAnatomy.tsx:36` · Wild Finds card body, 2-3 sentences · max 240 characters

- **Old:** Real sightings of birds, bugs and blooms: plants and animals people photographed in or near the park (within 1.5 km) in the last 14 days. Gemma must quote each one's source, and code checks the quote word for word.
- **Gemma:** Real birds, bugs and blooms photographed within 1.5 km of the park in the last 14 days. Gemma quotes the source for each find, and code checks it word for word.
- **Code check:** passed
- **Shipped:** Real birds, bugs and blooms photographed within 1.5 km of the park in the last 14 days. Gemma quotes the source for each find, and code checks it word for word.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Wild Finds are iNaturalist research-grade sightings within 1.5 km of the park in the last 14 days (WILD_RADIUS_KM, WILD_WINDOW_DAYS). / People photographed them. / Gemma must quote each find's source text; code checks the quote word for word. · KEEP: "1.5 km", "14 days", "Gemma", "word for word"

#### `home.pass.wild.safety`: rejected

`src/components/home/PassAnatomy.tsx:43` · safety note after the bold label "Safety built in.", 2 sentences · max 170 characters

- **Old:** Venomous snakes, poison ivy, stinging bugs and more ({blocked} risky groups in all) are never printed. Every Wild Find says “look, don't touch.”
- **Gemma:** Poison ivy, stinging bugs and {blocked} other risky groups are never printed. Every Wild Find says "look, don't touch."
- **Code check:** passed
- **Shipped:** Venomous snakes, poison ivy, stinging bugs and more ({blocked} risky groups in all) are never printed. Every Wild Find says “look, don't touch.”
- **Why:** UNTRUE: '{blocked} other risky groups' (the count already includes poison ivy and stinging bugs), and it drops venomous snakes. The code check passed it; the agent review caught it.
- **FACTS:** {blocked} is the number of blocked risky species groups (BLOCKED_TAXA.length: 63 since the evening of 2026-10-06; 17 when this copy was drafted), filled in by code. / Blocked: venomous snakes, poison ivy, stinging bugs and more. They are never printed. / Every Wild Find carries the line "look, don't touch." · KEEP: "never printed", "look, don't touch"

#### `home.pass.park.body`: accepted

`src/components/home/PassAnatomy.tsx:58` · Park Finds card body, 1-2 sentences · max 170 characters

- **Old:** Hoops, shelters, bridges and playground gear, straight from the park's OpenStreetMap map, with real counts like “2 basketball courts.”
- **Gemma:** Hoops, bridges and playgrounds pulled from OpenStreetMap. Code adds real counts, like "2 basketball courts."
- **Code check:** passed
- **Shipped:** Hoops, bridges and playgrounds pulled from OpenStreetMap. Code adds real counts, like "2 basketball courts."
- **Why:** True and shorter; it says code writes the counts. Straight quotes set as curly quotes in JSX.
- **FACTS:** Park Finds are things mapped inside the park on OpenStreetMap: hoops, shelters, bridges, playground gear. / Code writes the real counts, for example "2 basketball courts". · KEEP: "OpenStreetMap", "2 basketball courts"

#### `home.pass.lucky.body`: edited

`src/components/home/PassAnatomy.tsx:70` · Lucky Finds card body, 2-3 sentences · max 240 characters

- **Old:** Maybe-sightings, like a dog or a bike, backed by at least 3 Google Maps reviews from the last 2 years that mention them (counted via SerpApi). No proof, no Lucky Finds: the pass leaves them off and says why.
- **Gemma:** Things like dogs or bikes mentioned in at least 3 Google Maps reviews from the last 2 years. SerpApi counts them. If there is no proof, the pass leaves them off and says why.
- **Code check:** passed
- **Shipped:** Maybe-sightings, like dogs or bikes, mentioned in at least 3 Google Maps reviews from the last 2 years. SerpApi counts them. No proof? The pass leaves them off and says why. _(Gemma draft, edited)_
- **Why:** Gemma draft, edited: put back 'Maybe-sightings' (a Lucky Find is a maybe, not a promise) and the 'No proof?' hook.
- **FACTS:** Lucky Finds are maybe-sightings (a dog, a bike) that at least 3 Google Maps reviews from the last 2 years mention (MIN_MENTIONS, WINDOW_MONTHS). / Code counts the reviews through SerpApi; review text is never shown or sent to the AI. / Without enough reviews the pass leaves Lucky Finds off and says why. / Lucky Finds are NOT rare or bonus points. · KEEP: "3", "2 years", "SerpApi", "Google Maps"

#### `home.pass.spot.body`: accepted

`src/components/home/PassAnatomy.tsx:79` · Find This Spot card body, 2 short sentences · max 150 characters

- **Old:** Code draws a small black-and-white map of the park with a START and an X. Gemma writes a riddle about the spot.
- **Gemma:** Code draws a simple map with a START and an X. Gemma writes a riddle to help the kids find the spot.
- **Code check:** passed
- **Shipped:** Code draws a simple map with a START and an X. Gemma writes a riddle to help the kids find the spot.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Code (not AI) draws a small black-and-white map of the park with START and an X. / Gemma writes a riddle about the spot at the X. · KEEP: "START", "X", "Gemma"

#### `home.pass.october.body`: accepted

`src/components/home/PassAnatomy.tsx:97` · October monarch box card body, 2 short sentences · max 160 characters

- **Old:** Code counts monarchs reported nearby in the last 14 days, next to the same days last year. Printed honestly, even when it's zero.
- **Gemma:** Code counts nearby monarchs from the last 14 days versus the same days last year. It prints the real number, even if it is zero.
- **Code check:** passed
- **Shipped:** Code counts nearby monarchs from the last 14 days versus the same days last year. It prints the real number, even if it is zero.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Code (no AI) counts monarch butterflies reported nearby in the last 14 days, next to the same days last year. / The box prints the real count even when it is zero. · KEEP: "14 days", "last year"

#### `home.explore.sub`: accepted

`src/components/home/SampleParks.tsx:33` · subhead under "See a real pass, right now.", 2 short sentences · max 150 characters

- **Old:** Passes for parks near Dallas, already written from live park data for {ages}. Tap one to open it; no sign-up needed.
- **Gemma:** Example passes for parks near Dallas, made from live data for {ages}. Tap one to open it; no sign-up needed.
- **Code check:** passed
- **Shipped:** Example passes for parks near Dallas, made from live data for {ages}. Tap one to open it; no sign-up needed.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** The example parks are near Dallas. / {ages} is the age band, filled in by code (ages 6–10). / The passes are already made from live park data. / Opening one needs no sign-up. · KEEP: "Dallas", "no sign-up"

#### `home.explore.live.making`: accepted

`src/lib/home/showcase.ts:121` · status pill, 7 words or fewer · max 50 characters

- **Old:** Making today's example passes now
- **Gemma:** Making today's example passes
- **Code check:** passed
- **Shipped:** Making today's example passes
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Shown while the server is making today's example passes.

#### `home.explore.live.off`: accepted

`src/lib/home/showcase.ts:125` · status pill, 8 words or fewer · max 55 characters

- **Old:** Example passes are switched off on this server
- **Gemma:** Example passes are turned off
- **Code check:** passed
- **Shipped:** Example passes are turned off
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Shown when this server has example passes switched off (PREWARM_EXAMPLES=0).

#### `home.explore.live.notready`: unchanged

`src/lib/home/showcase.ts:126` · status pill, 6 words or fewer · max 45 characters

- **Old:** Example passes not ready yet
- **Gemma:** Example passes not ready yet
- **Code check:** passed
- **Shipped:** Example passes not ready yet
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** Shown when no example pass is ready yet.

#### `home.chips.lead`: rejected

`src/components/home/ExampleChips.tsx:18` · phone-only lead-in before a row of example-park buttons, ends with a colon, 7 words or fewer · max 40 characters

- **Old:** Just looking? Open a real pass:
- **Gemma:** Want a sneak peek:
- **Code check:** passed
- **Shipped:** Just looking? Open a real pass:
- **Why:** Garbled: a question that ends in a colon, and it drops 'real pass'.
- **FACTS:** The buttons after it open real example passes.

#### `home.card.stub`: rejected

`src/components/home/HeroPassCard.tsx:80` · tiny caption on the example pass card's tear-off stub, 6 words or fewer · max 40 characters

- **Old:** Grown-up's stub · answers & safety
- **Gemma:** Adult stub: answers & safety
- **Code check:** passed
- **Shipped:** Grown-up's stub · answers & safety
- **Why:** 'Adult' is off-voice; the site says 'grown-up' everywhere.
- **FACTS:** The bottom part of a pass is the grown-up's stub with the answers and safety notes.

#### `home.card.open`: accepted

`src/components/home/HeroPassCard.tsx:87` · tiny link, 3 words or fewer · max 20 characters

- **Old:** Open this pass
- **Gemma:** View pass
- **Code check:** passed
- **Shipped:** View pass
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Opens the real example pass shown on the card.

#### `home.hero.sticker`: unchanged

`src/components/home/HomeHero.tsx:13` · sticker on the hero picture, 4 words or fewer · max 22 characters

- **Old:** Fits on 1 page
- **Gemma:** Fits on 1 page
- **Code check:** passed
- **Shipped:** Fits on 1 page
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** A pass prints on one page. · KEEP: "1"

#### `home.cta.sub`: rejected

`src/components/home/FinalCta.tsx:13` · subhead under the final call to action, 1 sentence · max 120 characters

- **Old:** Free, one printable page, written for the park across the street, not some park somewhere else.
- **Gemma:** Free, one printable page, written for your specific park.
- **Code check:** passed
- **Shipped:** Free, one printable page, written for the park across the street, not some park somewhere else.
- **Why:** Loses 'the park across the street', the line's whole point and voice.
- **FACTS:** A pass is free. / It is one printable page. / It is written for the specific park you pick. · KEEP: "Free"

#### `home.parks.connemara.big`: accepted

`src/components/home/TwoParks.tsx:13` · label under the big number 70, 12 words or fewer · max 75 characters

- **Old:** kinds of plants and animals spotted in and around it in 2 weeks
- **Gemma:** species spotted nearby in 2 weeks
- **Code check:** passed
- **Shipped:** species spotted nearby in 2 weeks
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Connemara Meadow: 70 kinds (species) of plants and animals, iNaturalist research-grade sightings within 1.5 km, last 14 days, measured Oct 5, 2026. / Starts lowercase: it reads on from the number. · KEEP: "2 weeks"

#### `home.parks.connemara.small`: unchanged

`src/components/home/TwoParks.tsx:14` · label under the small number 0, 6 words or fewer · max 40 characters

- **Old:** playgrounds, courts or shelters
- **Gemma:** playgrounds, courts or shelters
- **Code check:** passed
- **Shipped:** playgrounds, courts or shelters
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** Connemara Meadow has 0 playgrounds, courts or shelters mapped on OpenStreetMap. / Starts lowercase: it reads on from the number.

#### `home.parks.celebration.big`: accepted

`src/components/home/TwoParks.tsx:20` · label under the big number 25, 8 words or fewer · max 50 characters

- **Old:** soccer fields mapped here, plus 6 courts
- **Gemma:** soccer fields, plus 6 courts
- **Code check:** passed
- **Shipped:** soccer fields, plus 6 courts
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Celebration Park: 25 soccer fields and 6 courts mapped on OpenStreetMap, measured Oct 5, 2026. / Starts lowercase: it reads on from the number. · KEEP: "6 courts"

#### `home.parks.celebration.small`: unchanged

`src/components/home/TwoParks.tsx:21` · label under the small number 0, 5 words or fewer · max 35 characters

- **Old:** recent wildlife sightings
- **Gemma:** recent wildlife sightings
- **Code check:** passed
- **Shipped:** recent wildlife sightings
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** Celebration Park had 0 research-grade wildlife sightings in the last 14 days. / Starts lowercase: it reads on from the number.

### footer (every page)

#### `footer.about`: accepted

`src/components/SiteFooter.tsx:10` · footer link to /about, 4 words or fewer · max 25 characters

- **Old:** About Grass Pass
- **Gemma:** About
- **Code check:** passed
- **Shipped:** About
- **Why:** Short, and the footer link already sits under the Grass Pass logo.
- **FACTS:** Links to the About page.

#### `footer.how`: accepted

`src/components/SiteFooter.tsx:10` · footer link to /how-it-works, 4 words or fewer · max 25 characters

- **Old:** How Grass Pass works
- **Gemma:** How it works
- **Code check:** passed
- **Shipped:** How it works
- **Why:** Short, and the footer link already sits under the Grass Pass logo.
- **FACTS:** Links to the How it works page.

### site meta + OG (every page)

#### `meta.home.description`: rejected

`src/app/layout.tsx:51` · meta description / social share text, 2-3 sentences · max 250 characters

- **Old:** A free one-page treasure hunt for your local park. Gemma 4, an open-weight AI model, reads that park's real map and the last 14 days of wildlife sightings and writes the clues. Code checks every one. Print it, and the phone stays in your pocket.
- **Gemma:** Free one-page treasure hunts for your local park. Gemma 4 AI reads real maps and wildlife sightings from the last 14 days to write the clues. Code checks every one. Print it and leave the phone at home.
- **Code check:** passed
- **Shipped:** A free one-page treasure hunt for your local park. Gemma 4, an open-weight AI model, reads that park's real map and the last 14 days of wildlife sightings and writes the clues. Code checks every one. Print it, and the phone stays in your pocket.
- **Why:** Drops 'open-weight' (the contest's core) and says 'leave the phone at home'.
- **FACTS:** The AI model is Gemma 4 (gemma-4-31B-it), Google's open-weight model (Apache-2.0), run on DigitalOcean serverless inference in the US. / It reads the park's real OpenStreetMap map and the last 14 days of iNaturalist sightings. / Code checks every clue against its source and removes any that fail; the model never decides what is safe. / Free, one printable page. · KEEP: "Gemma 4", "14 days"

### /how-it-works

#### `how.meta.title`: rejected

`src/app/how-it-works/page.tsx:48` · browser tab / share title, 12 words or fewer, starts with "How Grass Pass works" · max 75 characters

- **Old:** How Grass Pass works: real park data in, one open model, paper out
- **Gemma:** How Grass Pass works: real data, AI, and paper
- **Code check:** passed
- **Shipped:** How Grass Pass works: real park data in, one open model, paper out
- **Why:** Drops 'open model'.
- **FACTS:** Real park data goes in, one open model (Gemma 4) writes, a paper pass comes out. · KEEP: "How Grass Pass works"

#### `how.meta.description`: edited

`src/app/how-it-works/page.tsx:50` · meta description, 2-3 sentences · max 260 characters

- **Old:** Step by step: how Grass Pass turns one park's real map and recent wildlife sightings into a printable kids' pass. Gemma 4, an open model, writes the clues; code fact-checks every one. What the AI does and doesn't do, and what we measured.
- **Gemma:** See how we turn real maps and wildlife sightings into a printable pass. Gemma 4 AI writes the clues and code fact-checks every one. We share what the AI does, what it doesn't, and our measured results.
- **Code check:** passed
- **Shipped:** See how we turn a park's real map and wildlife sightings into a printable pass. Gemma 4, an open model, writes the clues and code fact-checks every one. What the AI does, what it doesn't, and what we measured. _(Gemma draft, edited)_
- **Why:** Gemma draft, edited: 'Gemma 4 AI' -> 'Gemma 4, an open model'; 'our measured results' -> 'what we measured'.
- **FACTS:** The AI model is Gemma 4 (gemma-4-31B-it), Google's open-weight model (Apache-2.0), run on DigitalOcean serverless inference in the US. / Code checks every clue against its source and removes any that fail; the model never decides what is safe. / The page shows what the AI does and doesn't do, and the measured results (misses included). · KEEP: "Gemma 4"

#### `how.h1`: unchanged

`src/app/how-it-works/page.tsx:437` · page headline, 7 words or fewer, ends with a full stop · max 45 characters

- **Old:** How a park becomes a pass.
- **Gemma:** How a park becomes a pass.
- **Code check:** passed
- **Shipped:** How a park becomes a pass.
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** The page explains how one real park becomes a printed pass.

#### `how.lead`: rejected

`src/app/how-it-works/page.tsx:440` · lead paragraph under the headline, 3-4 short sentences · max 230 characters

- **Old:** You pick the park. Gemma 4, an open AI model, writes the clues from its real map and the last two weeks of wildlife sightings. Code fact-checks every one. Your printer does the rest.
- **Gemma:** You pick the park. Gemma 4 AI writes the clues using real maps and the last 14 days of wildlife sightings. Code fact-checks every clue. Your printer does the rest.
- **Code check:** passed
- **Shipped:** You pick the park. Gemma 4, an open AI model, writes the clues from its real map and the last two weeks of wildlife sightings. Code fact-checks every one. Your printer does the rest.
- **Why:** Drops 'open'; otherwise the same as the current line.
- **FACTS:** The AI model is Gemma 4 (gemma-4-31B-it), Google's open-weight model (Apache-2.0), run on DigitalOcean serverless inference in the US. / Sources: the park's real map (OpenStreetMap) and the last 14 days of wildlife sightings (iNaturalist). / Code checks every clue against its source and removes any that fail; the model never decides what is safe. · KEEP: "Gemma 4"

#### `how.quick.title`: rejected

`src/app/how-it-works/page.tsx:468` · section headline (the 30-second version), 8 words or fewer · max 50 characters

- **Old:** Pick a park. Print a pass. Phone away.
- **Gemma:** Pick a park. Print. Phone away.
- **Code check:** passed
- **Shipped:** Pick a park. Print a pass. Phone away.
- **Why:** 'Pick a park. Print a pass. Phone away.' is the README / logo tagline; 'Print.' alone reads cut off.
- **FACTS:** The short version: pick a park, print a pass, put the phone away.

#### `how.quick.1.title`: rejected

`src/app/how-it-works/page.tsx:154` · card title, 5 words or fewer · max 30 characters

- **Old:** Pick a park & age
- **Gemma:** Pick a park and age
- **Code check:** passed
- **Shipped:** Pick a park & age
- **Why:** Kevin's own words (his home copy reference); kept.
- **FACTS:** Pick a real park and the kid's age band.

#### `how.quick.1.body`: rejected

`src/app/how-it-works/page.tsx:154` · card body, 1 sentence · max 100 characters

- **Old:** A real park near you, plus your kid's age: 4-6, 6-10 or 10-13.
- **Gemma:** Choose a local park and an age group: 4-6, 6-10, or 10-13.
- **Code check:** passed
- **Shipped:** A real park near you, plus your kid's age: 4-6, 6-10 or 10-13.
- **Why:** Drops 'your kid' for 'an age group'; less personal.
- **FACTS:** Age bands are exactly 4-6, 6-10 and 10-13 (AGE_BAND_INFO). · KEEP: "4-6", "6-10", "10-13"

#### `how.quick.2.title`: rejected

`src/app/how-it-works/page.tsx:157` · card title, 5 words or fewer · max 30 characters

- **Old:** We read the park
- **Gemma:** We gather the data
- **Code check:** passed
- **Shipped:** We read the park
- **Why:** 'We read the park' is more vivid.
- **FACTS:** Code collects the park's real data.

#### `how.quick.2.body`: rejected

`src/app/how-it-works/page.tsx:158` · card body, 1 sentence · max 120 characters

- **Old:** Its map, the last {days} days of wildlife sightings nearby, and what visitor reviews mention.
- **Gemma:** It uses the park map, visitor reviews, and wildlife sightings from the last {days} days.
- **Code check:** passed
- **Shipped:** Its map, the last {days} days of wildlife sightings nearby, and what visitor reviews mention.
- **Why:** Less accurate: we count what reviews mention, we don't use the reviews; drops 'nearby'.
- **FACTS:** {days} is filled in by code (WILD_WINDOW_DAYS = 14). / Data: the park's map (OpenStreetMap), nearby wildlife sightings (iNaturalist), and what Google Maps reviews mention (counts only, via SerpApi).

#### `how.quick.3.title`: unchanged

`src/app/how-it-works/page.tsx:162` · card title, 5 words or fewer; must say AI · max 30 characters

- **Old:** AI writes, code checks
- **Gemma:** AI writes, code checks
- **Code check:** passed
- **Shipped:** AI writes, code checks
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** The AI writes; code checks. · KEEP: "AI"

#### `how.quick.3.body`: edited

`src/app/how-it-works/page.tsx:163` · card body, 2 sentences · max 160 characters

- **Old:** Gemma 4, an open model, picks a fair mix and writes kid-sized clues. Code checks each one, and asks once more if too many fail.
- **Gemma:** Gemma 4 writes kid-friendly clues. Code checks every one for accuracy and asks once more if too many fail.
- **Code check:** passed
- **Shipped:** Gemma 4 writes kid-friendly clues. Code checks every one for accuracy and asks again if too many fail. _(Gemma draft, edited)_
- **Why:** True and simpler; the open-model fact is two lines above. Gemma draft, edited: 'asks once more' -> 'asks again'. Fact fix after the rebase onto main b5a862b (not Gemma): a pass now makes 1-3 model calls (MAX_MODEL_CALLS = 3), so 'once more' / 'one refill' is no longer true.
- **FACTS:** The AI model is Gemma 4 (gemma-4-31B-it), Google's open-weight model (Apache-2.0), run on DigitalOcean serverless inference in the US. / Code checks every clue against its source and removes any that fail; the model never decides what is safe. / If too many clues fail, code asks the model again (a pass makes at most 3 model calls, MAX_MODEL_CALLS). · KEEP: "Gemma 4", "asks again"

#### `how.quick.4.title`: accepted

`src/app/how-it-works/page.tsx:165` · card title, 5 words or fewer · max 30 characters

- **Old:** Print, phone away
- **Gemma:** Print and go
- **Code check:** passed
- **Shipped:** Print and go
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Print it and put the phone away.

#### `how.quick.4.body`: accepted

`src/app/how-it-works/page.tsx:165` · card body, 1-2 short sentences · max 100 characters

- **Old:** One page. The kid takes the hunt; you keep the answer key.
- **Gemma:** One page. The kid gets the hunt and you keep the answer key.
- **Code check:** passed
- **Shipped:** One page. The kid gets the hunt and you keep the answer key.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** One printed page: the kid's hunt on top, the grown-up's answer key below.

#### `how.quick.note`: edited

`src/app/how-it-works/page.tsx:491` · small note under the 4 cards, 2 sentences, one light joke allowed · max 170 characters

- **Old:** A new pass usually takes 10-30 seconds, about as long as finding the other shoe. A section with no data says "No data available" and why.
- **Gemma:** A pass takes 10-30 seconds, roughly the time it takes to find a missing shoe. If data is missing, it says "No data available" and why.
- **Code check:** passed
- **Shipped:** A new pass usually takes 10-30 seconds, up to about a minute and a half on a slow evening. If data is missing, the pass says "No data available" and why. _(Gemma draft, edited)_
- **Why:** Gemma draft, edited: put back 'new' and 'usually' (a pass can take up to about 90 s) and 'it says' -> 'the pass says'. Fact fix (RULES-7-06, Builder AD, not Gemma): the upper bound 'up to about a minute and a half on a slow evening' replaces the missing-shoe aside (the block's 170-character limit).
- **FACTS:** A new pass usually takes 10-30 seconds (PASS_WAIT_COPY), up to about a minute and a half when the free map websites are slow. / Missing data is never faked: the site says "No data available" and why. · KEEP: "10-30 seconds"

#### `how.steps.title`: rejected

`src/app/how-it-works/page.tsx:497` · section headline, 8 words or fewer · max 45 characters

- **Old:** From “which park?” to “found it!”
- **Gemma:** From choosing a park to finding it
- **Code check:** passed
- **Shipped:** From “which park?” to “found it!”
- **Why:** Garbled: 'finding it' reads as finding the park.
- **FACTS:** The section walks through every step from choosing a park to finding things.

#### `how.steps.intro`: accepted

`src/app/how-it-works/page.tsx:499` · intro paragraph, 2 sentences · max 190 characters

- **Old:** Each step says who does it: code (the same result every time), the open model, or you. The AI has one job: picking the finds and writing the words.
- **Gemma:** Each step is handled by code, the open model, or you. The AI has one job: picking the finds and writing the words.
- **Code check:** passed
- **Shipped:** Each step is handled by code, the open model, or you. The AI has one job: picking the finds and writing the words.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Each step is labelled code, the open model, or you. / Code gives the same result every time. / The AI's only job: picking the finds and writing the words.

#### `how.step.park.title`: accepted

`src/app/how-it-works/page.tsx:185` · step title, 5 words or fewer · max 35 characters

- **Old:** Find the park
- **Gemma:** Pick your park
- **Code check:** passed
- **Shipped:** Pick your park
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Step 1 (code): find the park.

#### `how.step.park.summary`: edited

`src/app/how-it-works/page.tsx:186` · step summary, 2 sentences · max 190 characters

- **Old:** Type a town, ZIP or park name, or tap Use my location (we round it to about 1 km). Code lists the parks within 5 km, from OpenStreetMap.
- **Gemma:** Search by town, ZIP, park name, or tap Use my location (rounded to 1 km). Code finds parks within 5 km using OpenStreetMap.
- **Code check:** passed
- **Shipped:** Search by town, ZIP, park name, or tap Use my location (rounded to about 1 km). Code finds parks within 5 km using OpenStreetMap. _(Gemma draft, edited)_
- **Why:** Gemma draft, edited: put back 'about' (the rounding is about 1 km, not exactly).
- **FACTS:** Search by town, ZIP or park name, or Use my location. / Your location is rounded to about 1 km in your browser. / Code lists parks within 5 km from OpenStreetMap. · KEEP: "Use my location", "1 km", "5 km", "OpenStreetMap"

#### `how.step.data.title`: rejected

`src/app/how-it-works/page.tsx:200` · step title, 6 words or fewer · max 40 characters

- **Old:** Gather what's really there
- **Gemma:** Find what is actually there
- **Code check:** passed
- **Shipped:** Gather what's really there
- **Why:** No better, and 'Find' clashes with step 1.
- **FACTS:** Step 2 (code): collect what is really in and near the park.

#### `how.step.data.summary`: accepted

`src/app/how-it-works/page.tsx:202` · step summary, 1-2 sentences · max 200 characters

- **Old:** Code fills three lists, each fact dated and sourced: Park Finds (OpenStreetMap), Wild Finds (iNaturalist, Wikipedia) and Lucky Finds (review counts via SerpApi).
- **Gemma:** Code builds three dated, sourced lists. Park Finds come from OpenStreetMap, Wild Finds from iNaturalist and Wikipedia, and Lucky Finds from Google review counts via SerpApi.
- **Code check:** passed
- **Shipped:** Code builds three dated, sourced lists. Park Finds come from OpenStreetMap, Wild Finds from iNaturalist and Wikipedia, and Lucky Finds from Google review counts via SerpApi.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Code fills three lists; each fact has a date and a source. / Park Finds: OpenStreetMap. Wild Finds: iNaturalist and Wikipedia. Lucky Finds: Google review counts via SerpApi. · KEEP: "Park Finds", "Wild Finds", "Lucky Finds", "OpenStreetMap", "iNaturalist", "Wikipedia", "SerpApi"

#### `how.step.safety.title`: rejected

`src/app/how-it-works/page.tsx:232` · step title, 9 words or fewer, light humor welcome · max 55 characters

- **Old:** Take out anything that bites, stings or itches
- **Gemma:** Skip the things that bite or sting
- **Code check:** passed
- **Shipped:** Take out anything that bites, stings or itches
- **Why:** Drops 'itches' (poison ivy) and the joke.
- **FACTS:** Step 3 (code): remove risky species.

#### `how.step.safety.summary`: accepted

`src/app/how-it-works/page.tsx:233` · step summary, 1-2 sentences · max 170 characters

- **Old:** Code removes {blocked} blocked groups of risky species (think fire ants and poison ivy) before the model sees the list, and checks again after.
- **Gemma:** Code removes {blocked} groups of risky species, like fire ants and poison ivy, before the model sees the list and checks again after.
- **Code check:** passed
- **Shipped:** Code removes {blocked} groups of risky species, like fire ants and poison ivy, before the model sees the list and checks again after.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** {blocked} is filled in by code (63 groups since the evening of 2026-10-06; 17 when this copy was drafted). / Examples: fire ants, poison ivy. / Removed before the model sees the list, and checked again after. · KEEP: "before", "after"

#### `how.step.model.title`: accepted

`src/app/how-it-works/page.tsx:252` · step title, 6 words or fewer · max 40 characters

- **Old:** The open model writes the clues
- **Gemma:** The AI writes the clues
- **Code check:** passed
- **Shipped:** The AI writes the clues
- **Why:** Says AI plainly; the badge next to it still says 'Done by the open model'.
- **FACTS:** Step 4 (the open model): write the clues.

#### `how.step.model.summary`: rejected

`src/app/how-it-works/page.tsx:255` · step summary, 3 short sentences · max 260 characters

- **Old:** Code sends the park's fact list to {model} on DigitalOcean serverless inference. It picks the finds by id and writes a clue and a proof quote for each, plus one riddle. Usually that is one call; step 6 is the exception.
- **Gemma:** Code sends the data to {model} on DigitalOcean serverless inference. The AI picks finds by id and writes a clue, a proof quote, and one riddle. This is usually one call, unless step 6 happens.
- **Code check:** passed
- **Shipped:** Code sends the park's fact list to {model} on DigitalOcean serverless inference. It picks the finds by id and writes a clue and a proof quote for each, plus one riddle. Usually that is one call; step 6 is the exception.
- **Why:** UNTRUE as written: 'writes a clue, a proof quote, and one riddle' reads as one clue in total, not one per find.
- **FACTS:** {model} is filled in by code: the model id, plus "(Google's Gemma 4, open weights, Apache-2.0)" when it is Gemma. / It runs on DigitalOcean serverless inference. / The model picks finds by id, writes a clue and a proof quote for each, plus one riddle. / Usually one call; step 6 (retry or refills, at most 3 calls) is the exception. · KEEP: "DigitalOcean", "step 6"

#### `how.step.checks.title`: rejected

`src/app/how-it-works/page.tsx:289` · step title, 5 words or fewer · max 35 characters

- **Old:** Code fact-checks every clue
- **Gemma:** Code checks every clue
- **Code check:** passed
- **Shipped:** Code fact-checks every clue
- **Why:** 'fact-checks' is the stronger true word.
- **FACTS:** Step 5 (code): check every clue.

#### `how.step.checks.summary`: rejected

`src/app/how-it-works/page.tsx:290` · step summary, 2 sentences · max 240 characters

- **Old:** Code never takes the AI's word for it. It removes any clue that breaks one of {always} hard rules (proof quote, name leaks, numbers, safety), and swaps out clues that miss {softer} style rules when it can.
- **Gemma:** Code doesn't just trust the AI. It removes clues that break {always} hard rules on safety, numbers, name leaks, or proof quotes, and swaps those that miss {softer} style rules.
- **Code check:** passed
- **Shipped:** Code never takes the AI's word for it. It removes any clue that breaks one of {always} hard rules (proof quote, name leaks, numbers, safety), and swaps out clues that miss {softer} style rules when it can.
- **Why:** 'doesn't just trust' weakens 'never takes the AI's word', and it drops 'when it can'.
- **FACTS:** {always} and {softer} are rule counts filled in by code. / Hard rules: proof quote, name leaks, numbers, safety. A clue that breaks one is removed. / Clues that miss a style rule are swapped out when a spare can replace them. · KEEP: "hard rules", "style rules"

#### `how.step.retry.title`: rejected

`src/app/how-it-works/page.tsx:328` · step title, 6 words or fewer · max 40 characters

- **Old:** Refill once, or print it short
- **Gemma:** Refill the list or print
- **Code check:** passed
- **Shipped:** Refill, or print it short
- **Why:** Loses the meaning ('print it short'). Old text kept, then: Fact fix after the rebase onto main b5a862b (not Gemma): a pass now makes 1-3 model calls (MAX_MODEL_CALLS = 3), so 'once more' / 'one refill' is no longer true.
- **FACTS:** Step 6 (code): ask once more, or print a shorter pass.

#### `how.step.retry.summary`: edited

`src/app/how-it-works/page.tsx:329` · step summary, 3 short sentences · max 190 characters

- **Old:** Too few clues survive? Code asks the model once more for the missing ones. Still short? The pass says how many are missing. No made-up filler.
- **Gemma:** Too few clues pass the check? Code asks the AI once more for the missing ones. Still short? We list how many are missing. No made-up filler.
- **Code check:** passed
- **Shipped:** Too few clues pass the check? Code asks the AI again for the missing ones (at most 3 calls per pass). Still short? We list how many are missing. No made-up filler. _(Gemma draft, edited)_
- **Why:** Gemma draft, edited: 'once more' -> 'again ... (at most 3 calls per pass)'. Fact fix after the rebase onto main b5a862b (not Gemma): a pass now makes 1-3 model calls (MAX_MODEL_CALLS = 3), so 'once more' / 'one refill' is no longer true.
- **FACTS:** If too few clues pass, code asks the model again for the missing ones (at most 3 model calls per pass, MAX_MODEL_CALLS). / If still short, the pass says how many finds are missing. / Nothing is padded with made-up finds. · KEEP: "again"

#### `how.step.spot.title`: unchanged

`src/app/how-it-works/page.tsx:353` · step title, 7 words or fewer · max 45 characters

- **Old:** Find This Spot and the October box
- **Gemma:** Find This Spot and the October box
- **Code check:** passed
- **Shipped:** Find This Spot and the October box
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** Step 7 (code): the Find This Spot map and the October box. · KEEP: "Find This Spot", "October box"

#### `how.step.spot.summary`: accepted

`src/app/how-it-works/page.tsx:354` · step summary, 2 sentences · max 150 characters

- **Old:** Code picks a landmark, draws a map with an X and measures the walk. The October box is all code.
- **Gemma:** Code picks a landmark, draws a map with an X, and measures the walk. The October box is all code.
- **Code check:** passed
- **Shipped:** Code picks a landmark, draws a map with an X, and measures the walk. The October box is all code.
- **Why:** Only adds a comma.
- **FACTS:** Code picks a landmark, draws a map with an X and measures the walk. / The October monarch box is all code (no AI). · KEEP: "October box"

#### `how.step.print.title`: accepted

`src/app/how-it-works/page.tsx:374` · step title, 5 words or fewer · max 35 characters

- **Old:** Print it, hide the phone
- **Gemma:** Print and ditch the phone
- **Code check:** passed
- **Shipped:** Print and ditch the phone
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Step 8 (you): print it and put the phone away.

#### `how.step.print.summary`: rejected

`src/app/how-it-works/page.tsx:375` · step summary, 2 sentences, light humor welcome · max 160 characters

- **Old:** One black-and-white page: the kid's hunt on top, your answer key and sources below. Then the phone goes in the bag.
- **Gemma:** One black-and-white page. The kid's hunt is on top, and the grown-up's answer key and sources are below.
- **Code check:** passed
- **Shipped:** One black-and-white page: the kid's hunt on top, your answer key and sources below. Then the phone goes in the bag.
- **Why:** Drops the joke ('the phone goes in the bag'); nothing gained.
- **FACTS:** One black-and-white page: the kid's hunt on top, the grown-up's answer key and sources below.

#### `how.step.cache.title`: accepted

`src/app/how-it-works/page.tsx:390` · step title, 5 words or fewer · max 35 characters

- **Old:** Saving work, and fair limits
- **Gemma:** Saved passes and fair limits
- **Code check:** passed
- **Shipped:** Saved passes and fair limits
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Step 9 (code): saved passes and fair limits.

#### `how.step.cache.summary`: rejected

`src/app/how-it-works/page.tsx:391` · step summary, 2 sentences · max 190 characters

- **Old:** Passes are saved for 30 days. A new pass needs a grown-up signed in ({perDay} a day); daily limits protect the model budget and the free map servers.
- **Gemma:** Passes are saved for 30 days. To keep map servers and budgets healthy, grown-ups get {perDay} new passes a day.
- **Code check:** passed
- **Shipped:** Passes are saved for 30 days. A new pass needs a grown-up signed in ({perDay} a day); daily limits protect the model budget and the free map servers.
- **Why:** Drops that a new pass needs a grown-up signed in, and ties the per-account limit to the map servers.
- **FACTS:** Passes are saved for 30 days. / {perDay} is filled in by code (2 new passes a day per grown-up). / Daily limits protect the model budget and the free map servers. · KEEP: "30 days"

#### `how.ai.title`: rejected

`src/app/how-it-works/page.tsx:505` · section headline, 9 words or fewer; must say AI · max 55 characters

- **Old:** The AI picks and writes. Code does the rest.
- **Gemma:** The AI writes. Code does the rest.
- **Code check:** passed
- **Shipped:** The AI picks and writes. Code does the rest.
- **Why:** Drops 'picks' (the AI also picks the finds).
- **FACTS:** The AI picks finds and writes words; code does everything else. · KEEP: "AI"

#### `how.ai.does.1`: rejected

`src/app/how-it-works/page.tsx:513` · bullet under "The AI does", 8 words or fewer, starts with a verb · max 50 characters

- **Old:** Pick the finds, inside the mix code allows.
- **Gemma:** Pick the finds using the code mix
- **Code check:** passed
- **Shipped:** Pick the finds, inside the mix code allows.
- **Why:** Garbled ('using the code mix'). Gemma mixed verb forms inside one list (Pick / Copies / Writes) and dropped the full stops; taking only some would leave the list inconsistent.
- **FACTS:** The AI picks the finds within the mix code allows.

#### `how.ai.does.2`: rejected

`src/app/how-it-works/page.tsx:514` · bullet under "The AI does", 8 words or fewer, starts with a verb · max 50 characters

- **Old:** Write each clue in kid words, plus a hint.
- **Gemma:** Write kid-level clues and hints
- **Code check:** passed
- **Shipped:** Write each clue in kid words, plus a hint.
- **Why:** Gemma mixed verb forms inside one list (Pick / Copies / Writes) and dropped the full stops; taking only some would leave the list inconsistent.
- **FACTS:** The AI writes each clue in kid-level words, plus an optional hint.

#### `how.ai.does.3`: rejected

`src/app/how-it-works/page.tsx:515` · bullet under "The AI does", 8 words or fewer, starts with a verb · max 50 characters

- **Old:** Rate each find easy, medium or hard.
- **Gemma:** Rate finds as easy, medium or hard
- **Code check:** passed
- **Shipped:** Rate each find easy, medium or hard.
- **Why:** Gemma mixed verb forms inside one list (Pick / Copies / Writes) and dropped the full stops; taking only some would leave the list inconsistent.
- **FACTS:** The AI rates each find easy, medium or hard.

#### `how.ai.does.4`: rejected

`src/app/how-it-works/page.tsx:516` · bullet under "The AI does", 8 words or fewer, starts with a verb · max 50 characters

- **Old:** Copy a proof quote from its facts.
- **Gemma:** Copies a proof quote from the facts.
- **Code check:** passed
- **Shipped:** Copy a proof quote from its facts.
- **Why:** Gemma mixed verb forms inside one list (Pick / Copies / Writes) and dropped the full stops; taking only some would leave the list inconsistent.
- **FACTS:** The AI copies a proof quote from each find's facts (code checks it word for word).

#### `how.ai.does.5`: rejected

`src/app/how-it-works/page.tsx:517` · bullet under "The AI does", 8 words or fewer, starts with a verb · max 50 characters

- **Old:** Write the Find This Spot riddle.
- **Gemma:** Writes the Find This Spot riddle.
- **Code check:** passed
- **Shipped:** Write the Find This Spot riddle.
- **Why:** Gemma mixed verb forms inside one list (Pick / Copies / Writes) and dropped the full stops; taking only some would leave the list inconsistent.
- **FACTS:** The AI writes the Find This Spot riddle. · KEEP: "Find This Spot"

#### `how.code.does.1`: rejected

`src/app/how-it-works/page.tsx:526` · bullet under "Code does", 8 words or fewer, starts with a verb · max 50 characters

- **Old:** Collect every fact, with its source and date.
- **Gemma:** Collects every fact, source, and date.
- **Code check:** passed
- **Shipped:** Collect every fact, with its source and date.
- **Why:** Gemma mixed verb forms inside one list (Pick / Copies / Writes) and dropped the full stops; taking only some would leave the list inconsistent.
- **FACTS:** Code collects every fact with its source and date.

#### `how.code.does.2`: rejected

`src/app/how-it-works/page.tsx:527` · bullet under "Code does", 8 words or fewer, starts with a verb · max 50 characters

- **Old:** Remove unsafe species, before and after.
- **Gemma:** Removes unsafe species before and after.
- **Code check:** passed
- **Shipped:** Remove unsafe species, before and after.
- **Why:** Gemma mixed verb forms inside one list (Pick / Copies / Writes) and dropped the full stops; taking only some would leave the list inconsistent.
- **FACTS:** Code removes unsafe species before and after the model. · KEEP: "before", "after"

#### `how.code.does.3`: rejected

`src/app/how-it-works/page.tsx:528` · bullet under "Code does", 8 words or fewer, starts with a verb · max 50 characters

- **Old:** Set the mix and the number of finds.
- **Gemma:** Sets the mix and number of finds.
- **Code check:** passed
- **Shipped:** Set the mix and the number of finds.
- **Why:** Gemma mixed verb forms inside one list (Pick / Copies / Writes) and dropped the full stops; taking only some would leave the list inconsistent.
- **FACTS:** Code sets the section mix and the number of finds.

#### `how.code.does.4`: rejected

`src/app/how-it-works/page.tsx:529` · bullet under "Code does", 8 words or fewer, starts with a verb · max 50 characters

- **Old:** Check every clue; remove failures.
- **Gemma:** Checks clues and removes failures.
- **Code check:** passed
- **Shipped:** Check every clue; remove failures.
- **Why:** Gemma mixed verb forms inside one list (Pick / Copies / Writes) and dropped the full stops; taking only some would leave the list inconsistent.
- **FACTS:** Code checks every clue and removes the ones that fail.

#### `how.code.does.5`: rejected

`src/app/how-it-works/page.tsx:530` · bullet under "Code does", 9 words or fewer, starts with a verb · max 55 characters

- **Old:** Pick the spot, draw the map, measure the walk.
- **Gemma:** Picks the spot, draws maps, and measures walks.
- **Code check:** passed
- **Shipped:** Pick the spot, draw the map, measure the walk.
- **Why:** Gemma mixed verb forms inside one list (Pick / Copies / Writes) and dropped the full stops; taking only some would leave the list inconsistent.
- **FACTS:** Code picks the Find This Spot place, draws the map and measures the walk.

#### `how.code.does.6`: rejected

`src/app/how-it-works/page.tsx:531` · bullet under "Code does", 9 words or fewer, starts with a verb · max 55 characters

- **Old:** Write every number, date, safety line and answer.
- **Gemma:** Writes the numbers, dates, safety lines, and answers.
- **Code check:** passed
- **Shipped:** Write every number, date, safety line and answer.
- **Why:** Gemma mixed verb forms inside one list (Pick / Copies / Writes) and dropped the full stops; taking only some would leave the list inconsistent.
- **FACTS:** Code writes every number, date, safety line and answer on the pass.

#### `how.ai.schema`: accepted

`src/app/how-it-works/page.tsx:536` · one sentence under the two lists · max 110 characters

- **Old:** The AI can't invent a find: its answer's schema only allows ids from the park's own list.
- **Gemma:** The AI cannot invent finds because it can only use ids from the park's own fact list.
- **Code check:** passed
- **Shipped:** The AI cannot invent finds because it can only use ids from the park's own fact list.
- **Why:** Clearer: no 'schema' jargon, same fact.
- **FACTS:** The model's JSON answer schema only allows ids from the park's own fact list, so it cannot invent a find.

#### `how.open.title`: unchanged

`src/app/how-it-works/page.tsx:540` · section headline, 6 words or fewer · max 40 characters

- **Old:** Open weights, our own rules
- **Gemma:** Open weights, our own rules
- **Code check:** passed
- **Shipped:** Open weights, our own rules
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** Gemma 4's weights are open; the rules live in our code.

#### `how.open.1.title`: rejected

`src/app/how-it-works/page.tsx:543` · card title, 5 words or fewer · max 30 characters

- **Old:** The licence is open.
- **Gemma:** Open licensing
- **Code check:** passed
- **Shipped:** The licence is open.
- **Why:** The three card titles must match; the other two were rejected.
- **FACTS:** Gemma 4's licence is Apache-2.0.

#### `how.open.1.body`: rejected

`src/app/how-it-works/page.tsx:543` · card body, 1 sentence · max 100 characters

- **Old:** Gemma 4's weights are Apache-2.0: anyone can download, run and build on them.
- **Gemma:** Gemma 4 uses Apache-2.0, so anyone can download, run and build on it.
- **Code check:** passed
- **Shipped:** Gemma 4's weights are Apache-2.0: anyone can download, run and build on them.
- **Why:** Garbled: 'Gemma 4 uses Apache-2.0' (the weights are licensed Apache-2.0).
- **FACTS:** Gemma 4's weights are Apache-2.0: anyone can download, run and build on them. · KEEP: "Gemma 4", "Apache-2.0"

#### `how.open.2.title`: rejected

`src/app/how-it-works/page.tsx:546` · card title, 5 words or fewer · max 30 characters

- **Old:** It can be self-hosted.
- **Gemma:** Self-hosting works
- **Code check:** passed
- **Shipped:** It can be self-hosted.
- **Why:** 'Self-hosting works' claims something we have not measured.
- **FACTS:** The app can talk to a self-hosted model server.

#### `how.open.2.body`: edited

`src/app/how-it-works/page.tsx:547` · card body, 2 short sentences; must give the measured self-host result · max 150 characters

- **Old:** Any OpenAI-compatible server works, such as Ollama on your computer. Not measured yet.
- **Gemma:** Use any OpenAI-compatible server, like Ollama on your computer. Not measured yet.
- **Code check:** passed
- **Shipped:** Any OpenAI-compatible server, like Ollama. On a laptop CPU: $0, but 0 of 5 passes complete within the app's limits; with more time, 1-3 min a pass. _(Gemma draft, edited)_
- **Why:** True, on tone, at least as clear as before. Fact fix after the self-host measurement (Builder W, 2026-10-06, not Gemma): a self-hosted run was measured (evals/results/2026-10-06-selfhost-notes.md), so 'not measured yet' is no longer true. The accepted Gemma draft became "edited". Fact fix (RULES-6-02, Builder AA, not Gemma): '1-3 minutes a pass' was measured only with the eval's longer clock; with the app's normal limits 0 of 5 passes were complete, so the card now says both. Fact fix (RULES-7-02, Builder AD, not Gemma): 2 of the 5 app-clock passes did finish (short, 6 of 8), and the 70 s limit of that run is not the hosted site's (30-40 s sized first calls), so the card says '0 of 5 passes complete within the app's limits'.
- **FACTS:** Any OpenAI-compatible server works, for example Ollama on your own computer. / Measured: Gemma 4 E2B on a laptop CPU costs $0 but takes 1-3 minutes a pass, too slow for the app's 70 s limit. / With the app's normal time limits, 0 of 5 passes finished complete; given more time (the eval's longer clock), a pass takes 1-3 minutes. · KEEP: "OpenAI-compatible", "Ollama", "$0", "0 of 5"

#### `how.open.3.title`: rejected

`src/app/how-it-works/page.tsx:551` · card title, 5 words or fewer · max 30 characters

- **Old:** Our rules, not a vendor's.
- **Gemma:** Our rules, not theirs
- **Code check:** passed
- **Shipped:** Our rules, not a vendor's.
- **Why:** 'not theirs' is vague (whose?).
- **FACTS:** The safety and truth rules are in our code, not a model vendor's.

#### `how.open.3.body`: rejected

`src/app/how-it-works/page.tsx:552` · card body, 1 sentence · max 110 characters

- **Old:** The same checks run on any model; Llama 4 Maverick went through them in our test.
- **Gemma:** We run the same checks on every model, including Llama 4 Maverick.
- **Code check:** passed
- **Shipped:** The same checks run on any model; Llama 4 Maverick went through them in our test.
- **Why:** UNTRUE: 'every model' (we tested two).
- **FACTS:** The same checks run on any model. / Llama 4 Maverick was run through the same checks in our eval. · KEEP: "Llama 4 Maverick"

#### `how.limits.title`: accepted

`src/app/how-it-works/page.tsx:652` · section headline, 6 words or fewer · max 40 characters

- **Old:** What doesn’t work (yet)
- **Gemma:** Where we fall short
- **Code check:** passed
- **Shipped:** Where we fall short
- **Why:** Honest and plain.
- **FACTS:** The section lists the app's honest limits.

#### `how.privacy.title`: rejected

`src/app/how-it-works/page.tsx:679` · section headline, 5 words or fewer · max 35 characters

- **Old:** Nothing about your child
- **Gemma:** Kid privacy first
- **Code check:** passed
- **Shipped:** Nothing about your child
- **Why:** A slogan; the current title says the actual fact.
- **FACTS:** Nothing about the child is asked for or sent.

#### `how.built.title`: rejected

`src/app/how-it-works/page.tsx:700` · section headline, 9 words or fewer · max 60 characters

- **Old:** Built in the contest week, with AI coding agents
- **Gemma:** Built in a week with AI
- **Code check:** passed
- **Shipped:** Built in the contest week, with AI coding agents
- **Why:** 'in a week' and 'with AI' are vaguer than 'in the contest week, with AI coding agents'.
- **FACTS:** Built during the contest week with AI coding agents (Claude Code).

#### `how.built.body`: rejected

`src/app/how-it-works/page.tsx:702` · short paragraph, 2 sentences · max 200 characters

- **Old:** Built during the Hacktoberfest 2026 Week 1 entry period (first commit Oct 5, 2026). Kevin made the decisions; AI coding agents wrote and reviewed most of the code.
- **Gemma:** Built for Hacktoberfest 2026 Week 1, starting Oct 5, 2026. Kevin made the calls, while AI coding agents wrote and reviewed the code.
- **Code check:** passed
- **Shipped:** Built during the Hacktoberfest 2026 Week 1 entry period (first commit Oct 5, 2026). Kevin made the decisions; AI coding agents wrote and reviewed most of the code.
- **Why:** UNTRUE: drops 'most of' (AI agents wrote most, not all, of the code).
- **FACTS:** Built during the Hacktoberfest 2026 Week 1 entry period; first commit Oct 5, 2026. / Kevin made the decisions; AI coding agents wrote and reviewed most of the code. · KEEP: "Hacktoberfest 2026 Week 1", "Oct 5, 2026", "Kevin"

#### `how.privacy.1`: accepted

`src/lib/about/content.ts:212` · privacy bullet, 1-2 short sentences · max 90 characters

- **Old:** No names, no photos, no analytics. Browsing and printing set no cookie.
- **Gemma:** No names, photos, or analytics. Browsing and printing set no cookie.
- **Code check:** passed
- **Shipped:** No names, photos, or analytics. Browsing and printing set no cookie.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** No names, no photos, no analytics. / Browsing and printing set no cookie. · KEEP: "no cookie"

#### `how.privacy.3`: rejected

`src/lib/about/content.ts:214` · privacy bullet, 1 sentence · max 100 characters

- **Old:** What you type goes to our server and OpenStreetMap, never into the web address.
- **Gemma:** Your typing goes to our server and OpenStreetMap, never the web address.
- **Code check:** passed
- **Shipped:** What you type goes to our server and OpenStreetMap, never into the web address.
- **Why:** 'Your typing' is awkward.
- **FACTS:** What you type goes to our server and OpenStreetMap (Nominatim), never into the web address. · KEEP: "OpenStreetMap", "web address"

#### `how.privacy.4`: edited

`src/lib/about/content.ts:215` · privacy bullet, 1 sentence · max 80 characters

- **Old:** "Use my location" is rounded to about 1 km in your browser.
- **Gemma:** Use my location is rounded to about 1 km in your browser before it is sent.
- **Code check:** passed
- **Shipped:** "Use my location" is rounded to about 1 km in your browser before it is sent. _(Gemma draft, edited)_
- **Why:** Gemma draft, edited: put back the quotes around the button name.
- **FACTS:** "Use my location" is rounded to about 1 km in your browser before it is sent. · KEEP: "Use my location", "1 km", "browser"

#### `how.privacy.5`: accepted

`src/lib/about/content.ts:216` · privacy bullet, 1 sentence · max 90 characters

- **Old:** The model sees the park's public facts and the age band, nothing about you.
- **Gemma:** The AI sees park facts and the age band, nothing about you or your child.
- **Code check:** passed
- **Shipped:** The AI sees park facts and the age band, nothing about you or your child.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** The model gets the park's public facts and the age band, nothing about you or your child. · KEEP: "age band"

### /about

#### `about.meta.title`: rejected

`src/app/about/page.tsx:50` · browser tab / share title, 12 words or fewer, starts with "About Grass Pass" · max 70 characters

- **Old:** About Grass Pass: an open model, a real park and a pencil
- **Gemma:** About Grass Pass: an open AI model, a park and a pencil
- **Code check:** passed
- **Shipped:** About Grass Pass: an open model, a real park and a pencil
- **Why:** Drops 'real' (the point of the app).
- **FACTS:** Grass Pass: an open AI model, a real park, a pencil. · KEEP: "About Grass Pass"

#### `about.meta.description`: rejected

`src/app/about/page.tsx:52` · meta description, 2-3 sentences · max 280 characters

- **Old:** Gemma 4, an open-weight model, writes each Grass Pass from one park's real data: OpenStreetMap, iNaturalist, Wikipedia and Google review counts (SerpApi). Code checks every clue. What we measured (misses included), what leaves your device, and every credit.
- **Gemma:** Gemma 4, an open-weight model, writes each pass using OpenStreetMap, iNaturalist, Wikipedia and SerpApi. Code checks every clue against its source. We show what we measured, what leaves your device, and every credit.
- **Code check:** passed
- **Shipped:** Gemma 4, an open-weight model, writes each Grass Pass from one park's real data: OpenStreetMap, iNaturalist, Wikipedia and Google review counts (SerpApi). Code checks every clue. What we measured (misses included), what leaves your device, and every credit.
- **Why:** Drops 'Google review counts' (SerpApi alone means nothing to a parent) and 'misses included'.
- **FACTS:** The AI model is Gemma 4 (gemma-4-31B-it), Google's open-weight model (Apache-2.0), run on DigitalOcean serverless inference in the US. / Data: OpenStreetMap, iNaturalist, Wikipedia and Google review counts via SerpApi. / Code checks every clue against its source and removes any that fail; the model never decides what is safe. / The page shows what we measured (misses included), what leaves your device, and every credit. · KEEP: "Gemma 4", "OpenStreetMap", "iNaturalist", "Wikipedia", "SerpApi"

#### `about.h1`: rejected

`src/app/about/page.tsx:83` · page headline, 9 words or fewer, ends with a full stop · max 50 characters

- **Old:** An open model, a real park and a pencil.
- **Gemma:** An open AI model, a park and a pencil.
- **Code check:** passed
- **Shipped:** An open model, a real park and a pencil.
- **Why:** Drops 'real'.
- **FACTS:** Grass Pass = an open AI model + a real park + a pencil.

#### `about.lead`: rejected

`src/app/about/page.tsx:86` · lead paragraph, 3-4 short sentences · max 220 characters

- **Old:** A one-page treasure hunt for a real park. Gemma 4, an open-weight model, writes clues from its map and recent wildlife sightings. Code checks each one. The finding happens on paper.
- **Gemma:** A one-page hunt for a real park. Gemma 4 writes clues from maps and wildlife sightings. Code checks every clue for accuracy. The finding happens on paper.
- **Code check:** passed
- **Shipped:** A one-page treasure hunt for a real park. Gemma 4, an open-weight model, writes clues from its map and recent wildlife sightings. Code checks each one. The finding happens on paper.
- **Why:** Drops 'open-weight' and 'recent'.
- **FACTS:** The AI model is Gemma 4 (gemma-4-31B-it), Google's open-weight model (Apache-2.0), run on DigitalOcean serverless inference in the US. / Sources: the park's map and recent wildlife sightings. / Code checks every clue against its source and removes any that fail; the model never decides what is safe. / One printed page; the hunt happens on paper. · KEEP: "Gemma 4"

#### `about.howlink`: accepted

`src/app/about/page.tsx:105` · primary button to /how-it-works, 8 words or fewer · max 45 characters

- **Old:** See how a pass is made, step by step
- **Gemma:** See how a pass is made
- **Code check:** passed
- **Shipped:** See how a pass is made
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Links to the step-by-step How it works page.

#### `about.measured.title`: unchanged

`src/app/about/page.tsx:122` · section headline, 5 words or fewer · max 30 characters

- **Old:** Measured, not promised.
- **Gemma:** Measured, not promised.
- **Code check:** passed
- **Shipped:** Measured, not promised.
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** The numbers below are measured in a real eval run; misses are shown.

#### `about.inside.title`: rejected

`src/app/about/page.tsx:173` · section headline, 7 words or fewer · max 45 characters

- **Old:** Open model. Real data. Rules in code.
- **Gemma:** Open model. Real data. Coded rules.
- **Code check:** passed
- **Shipped:** Open model. Real data. Rules in code.
- **Why:** 'Coded rules' is weaker than 'Rules in code'.
- **FACTS:** An open model, real data, and rules enforced in code.

#### `about.model.title`: unchanged

`src/app/about/page.tsx:184` · card title, 6 words or fewer · max 35 characters

- **Old:** Gemma 4 writes the clues
- **Gemma:** Gemma 4 writes the clues
- **Code check:** passed
- **Shipped:** Gemma 4 writes the clues
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** The AI model is Gemma 4 (gemma-4-31B-it), Google's open-weight model (Apache-2.0), run on DigitalOcean serverless inference in the US. · KEEP: "Gemma 4"

#### `about.whyopen.1`: unchanged

`src/lib/about/content.ts:85` · check-mark bullet, 1 sentence · max 70 characters

- **Old:** Anyone can download, run and build on the weights.
- **Gemma:** Anyone can download, run and build on the weights.
- **Code check:** passed
- **Shipped:** Anyone can download, run and build on the weights.
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** Gemma 4's weights are open (Apache-2.0): anyone can download, run and build on them.

#### `about.whyopen.2`: accepted

`src/lib/about/content.ts:86` · check-mark bullet, 1 sentence · max 70 characters

- **Old:** Our safety rules live in our code, not a vendor's.
- **Gemma:** Our safety rules are in our code, not a vendor's.
- **Code check:** passed
- **Shipped:** Our safety rules are in our code, not a vendor's.
- **Why:** Tiny change.
- **FACTS:** The safety rules are in our code, not a model vendor's.

#### `about.whyopen.3`: unchanged

`src/lib/about/content.ts:87` · check-mark bullet, 1 sentence; must give the measured self-host result · max 70 characters

- **Old:** Self-hosting is possible, but not measured yet.
- **Gemma:** Self-hosting is possible, but not measured yet.
- **Code check:** passed
- **Shipped:** Self-hosted on a laptop CPU: $0, but slow.
- **Why:** Gemma returned the current text unchanged. Fact fix after the self-host measurement (Builder W, 2026-10-06, not Gemma): a self-hosted run was measured (evals/results/2026-10-06-selfhost-notes.md), so 'not measured yet' is no longer true.
- **FACTS:** Measured: self-hosted on a laptop CPU, a pass costs $0 but is slow (too slow for the app's 70 s limit). · KEEP: "$0", "slow"

#### `about.data.title`: rejected

`src/app/about/page.tsx:221` · card title, 5 words or fewer · max 30 characters

- **Old:** Four real sources, dated
- **Gemma:** Four dated data sources
- **Code check:** passed
- **Shipped:** Four real sources, dated
- **Why:** Drops 'real'.
- **FACTS:** Four real data sources (OpenStreetMap, iNaturalist, Wikipedia, SerpApi), each fact dated.

#### `about.data.osm`: rejected

`src/lib/about/content.ts:98` · one-line description of a data source (OpenStreetMap), 8 words or fewer · max 50 characters

- **Old:** Parks, paths and what is mapped inside them
- **Gemma:** Parks, paths and what's inside them
- **Code check:** passed
- **Shipped:** Parks, paths and what is mapped inside them
- **Why:** Drops 'mapped' (only what is mapped is used).
- **FACTS:** OpenStreetMap gives the parks, their paths and what is mapped inside them.

#### `about.data.inat`: accepted

`src/lib/about/content.ts:106` · one-line description of a data source (iNaturalist), 8 words or fewer · max 50 characters

- **Old:** Wildlife people really spotted nearby
- **Gemma:** Wildlife people actually spotted nearby
- **Code check:** passed
- **Shipped:** Wildlife people actually spotted nearby
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** iNaturalist gives wildlife people really photographed nearby (research-grade).

#### `about.data.wiki`: accepted

`src/lib/about/content.ts:113` · one-line description of a data source (Wikipedia), 8 words or fewer · max 50 characters

- **Old:** A short fact about each species
- **Gemma:** A short summary of each species
- **Code check:** passed
- **Shipped:** A short summary of each species
- **Why:** More accurate: it is a summary.
- **FACTS:** Wikipedia gives a short summary of each species.

#### `about.data.serp`: accepted

`src/lib/about/content.ts:120` · one-line description of a data source (SerpApi), 10 words or fewer · max 60 characters

- **Old:** How often Google Maps reviews mention dogs or bikes
- **Gemma:** Google Maps review counts for dogs or bikes
- **Code check:** passed
- **Shipped:** Google Maps review counts for dogs or bikes
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** SerpApi gives counts of how often Google Maps reviews mention things like dogs or bikes (counts only, no review text). · KEEP: "Google Maps"

#### `about.data.nodata`: accepted

`src/app/about/page.tsx:237` · small note, 2 short sentences; must keep the quoted words · max 80 characters

- **Old:** No data? The pass says "No data available" and why. Never padded.
- **Gemma:** No data? We say "No data available" and why. We never pad the list.
- **Code check:** passed
- **Shipped:** No data? We say "No data available" and why. We never pad the list.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Missing data is never faked: the site says "No data available" and why. / Passes are never padded with generic items.

#### `about.safety.title`: rejected

`src/app/about/page.tsx:245` · card title, 4 words or fewer · max 25 characters

- **Old:** Safety by code
- **Gemma:** Safety via code
- **Code check:** passed
- **Shipped:** Safety by code
- **Why:** 'via' is stiffer.
- **FACTS:** Safety is enforced by code, not the AI.

#### `about.safety.1`: rejected

`src/app/about/page.tsx` · bullet, 1 sentence · max 90 characters

- **Old:** {blocked} risky groups are never printed, checked before and after the model.
- **Gemma:** {blocked} groups are never printed, checked before and after the AI.
- **Code check:** passed
- **Shipped:** {blocked} risky groups are never printed, checked before and after the model.
- **Why:** Drops 'risky' (what the groups are).
- **FACTS:** {blocked} is filled in by code (63 groups since the evening of 2026-10-06; 17 when this copy was drafted). / Blocked groups are never printed; checked before and after the model. · KEEP: "never printed", "before and after"

#### `about.safety.2`: accepted

`src/app/about/page.tsx:249` · bullet, 1 sentence · max 60 characters

- **Old:** Every clue must quote its source word for word.
- **Gemma:** Every clue quotes its source word for word.
- **Code check:** passed
- **Shipped:** Every clue quotes its source word for word.
- **Why:** True for every printed clue (one that fails is removed).
- **FACTS:** Every clue must quote its source word for word (code checks). · KEEP: "word for word"

#### `about.safety.3`: accepted

`src/app/about/page.tsx:250` · bullet, 1 sentence · max 60 characters

- **Old:** Every number, date and safety line is written by code.
- **Gemma:** Code writes every number, date and safety line.
- **Code check:** passed
- **Shipped:** Code writes every number, date and safety line.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Code writes every number, date and safety line.

#### `about.privacy.1`: accepted

`src/lib/about/content.ts:129` · privacy check-mark bullet, 1 short sentence · max 60 characters

- **Old:** Browsing and printing need no account or cookie.
- **Gemma:** No account or cookies needed to browse and print.
- **Code check:** passed
- **Shipped:** No account or cookies needed to browse and print.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Browsing and printing need no account and set no cookie.

#### `about.privacy.2`: accepted

`src/lib/about/content.ts:130` · privacy check-mark bullet, 1 sentence · max 85 characters

- **Old:** Sign-in only to make a new pass; we keep a scrambled ID, no email or name.
- **Gemma:** Sign-in is only for new passes. We keep a scrambled ID, no name or email.
- **Code check:** passed
- **Shipped:** Sign-in is only for new passes. We keep a scrambled ID, no name or email.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Sign-in is needed only to make a new pass (or report). / We keep only a scrambled ID: no email, no name. · KEEP: "scrambled ID"

#### `about.privacy.3`: accepted

`src/lib/about/content.ts:131` · privacy check-mark bullet, 1 short sentence · max 50 characters

- **Old:** Nothing about your child is asked for.
- **Gemma:** We never ask for info about your child.
- **Code check:** passed
- **Shipped:** We never ask for info about your child.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Nothing about the child is asked for.

#### `about.privacy.4`: edited

`src/lib/about/content.ts:132` · privacy check-mark bullet, 1 short sentence · max 55 characters

- **Old:** Your location is rounded to about 1 km first.
- **Gemma:** Your location is rounded to 1 km in your browser.
- **Code check:** passed
- **Shipped:** Your location is rounded to about 1 km in your browser. _(Gemma draft, edited)_
- **Why:** Gemma draft, edited: put back 'about'.
- **FACTS:** Your location is rounded to about 1 km before it leaves your browser. · KEEP: "1 km"

#### `about.privacy.5`: rejected

`src/lib/about/content.ts:133` · privacy check-mark bullet, 1 short sentence · max 55 characters

- **Old:** Your IP is kept only scrambled, for about a day.
- **Gemma:** Your IP is kept scrambled for about a day.
- **Code check:** passed
- **Shipped:** Your IP is kept only scrambled, for about a day.
- **Why:** Drops 'only' (the raw IP is never kept).
- **FACTS:** Your IP address is kept only as a keyed hash (scrambled), in counters that expire within about a day. · KEEP: "a day"

#### `about.privacy.6`: accepted

`src/lib/about/content.ts:134` · privacy check-mark bullet, 1 short sentence · max 55 characters

- **Old:** Park facts and age band go to the model (US).
- **Gemma:** Park facts and age band go to the model in the US.
- **Code check:** passed
- **Shipped:** Park facts and age band go to the model in the US.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** The park's facts and the age band are sent to the model, which runs in the US (DigitalOcean). · KEEP: "US"

#### `about.limit.4`: rejected

`src/lib/about/content.ts:229` · limit bullet, 1 short sentence · max 60 characters

- **Old:** The read-it-as-a-7-year-old check is not done yet.
- **Gemma:** The 7 year old reading check is not done yet.
- **Code check:** passed
- **Shipped:** The read-it-as-a-7-year-old check is not done yet.
- **Why:** Garbled ('The 7 year old reading check').
- **FACTS:** A check where clues are read as a 7-year-old would is planned, NOT done yet. · KEEP: "7", "not done yet"

#### `about.limit.5`: unchanged

`src/lib/about/content.ts:230` · limit bullet, 1 short sentence · max 60 characters

- **Old:** Find This Spot and Lucky Finds are not in the eval yet.
- **Gemma:** Find This Spot and Lucky Finds are not in the eval yet.
- **Code check:** passed
- **Shipped:** Find This Spot and Lucky Finds are not in the eval yet.
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** Find This Spot and Lucky Finds were not part of the eval run yet. · KEEP: "Find This Spot", "Lucky Finds"

#### `about.details.title`: rejected

`src/app/about/page.tsx:296` · section headline, 5 words or fewer · max 35 characters

- **Old:** Details, one click away.
- **Gemma:** More details one click away
- **Code check:** passed
- **Shipped:** Details, one click away.
- **Why:** Lost its punctuation; no better.
- **FACTS:** The details are folded and open with one click.

#### `about.privacy.note2`: edited

`src/lib/about/content.ts:196` · paragraph under the privacy table, 1 sentence · max 120 characters

- **Old:** The model runs on DigitalOcean's servers in the US, so the park facts and the age band do leave your device.
- **Gemma:** The model runs on DigitalOcean servers in the US, so park facts and age bands leave your device.
- **Code check:** passed
- **Shipped:** The model runs on DigitalOcean servers in the US, so park facts and the age band leave your device. _(Gemma draft, edited)_
- **Why:** Gemma draft, edited: 'age bands' -> 'the age band'.
- **FACTS:** The model runs on DigitalOcean's servers in the US. / The park facts and the age band leave your device. · KEEP: "DigitalOcean", "US"

#### `about.privacy.note3`: rejected

`src/lib/about/content.ts:197` · paragraph under the privacy table, 1 sentence · max 130 characters

- **Old:** Our logs record which source or model ran, timing, outcome and pass id; never the prompt, your IP or what you typed.
- **Gemma:** Logs track the model, timing, outcome, and pass id; they never record your prompt, IP, or what you typed.
- **Code check:** passed
- **Shipped:** Our logs record which source or model ran, timing, outcome and pass id; never the prompt, your IP or what you typed.
- **Why:** UNTRUE: 'your prompt' (the prompt is ours, not the visitor's), and drops 'which source'.
- **FACTS:** Logs record which source or model ran, timing, outcome and pass id. / Logs never record the prompt, your IP or what you typed. · KEEP: "never"

### /signin + sign-in card

#### `signin.err.rate`: rejected

`src/lib/accounts/signin-errors.ts:9` · error message, 2 sentences · max 120 characters

- **Old:** Whoa, that's a lot of sign-in attempts from your connection. Please wait a few minutes and try again.
- **Gemma:** Too many sign-in attempts from here. Take a few minutes and try again.
- **Code check:** passed
- **Shipped:** Whoa, that's a lot of sign-in attempts from your connection. Please wait a few minutes and try again.
- **Why:** 'from here' is vague, and the friendly 'Whoa' goes.
- **FACTS:** Too many sign-in attempts from this connection; wait a few minutes and try again.

#### `signin.err.unavailable`: accepted

`src/lib/accounts/signin-errors.ts:10` · error message, 2 short sentences · max 100 characters

- **Old:** That sign-in option isn't set up on this server. Pick another one below.
- **Gemma:** That sign-in option is not set up here. Try another one below.
- **Code check:** passed
- **Shipped:** That sign-in option is not set up here. Try another one below.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** That sign-in option isn't set up on this server; other options are below.

#### `signin.err.denied`: accepted

`src/lib/accounts/signin-errors.ts:11` · error message, 2 short sentences · max 100 characters

- **Old:** Sign-in was cancelled, so nothing changed. Changed your mind? Try again below.
- **Gemma:** Sign-in was cancelled. Nothing changed, but you can try again below.
- **Code check:** passed
- **Shipped:** Sign-in was cancelled. Nothing changed, but you can try again below.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Sign-in was cancelled; nothing changed. You can try again below.

#### `signin.err.callback`: accepted

`src/lib/accounts/signin-errors.ts:12` · error message, 1-2 short sentences · max 80 characters

- **Old:** The sign-in page didn't finish loading. Please try again.
- **Gemma:** The sign-in page didn't finish. Please try again.
- **Code check:** passed
- **Shipped:** The sign-in page didn't finish. Please try again.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** The provider's sign-in page didn't finish; try again.

#### `signin.err.config`: accepted

`src/lib/accounts/signin-errors.ts:13` · error message, 2 sentences · max 120 characters

- **Old:** Sign-in isn't set up correctly on this server right now. The examples and saved passes still work.
- **Gemma:** Sign-in isn't set up right on this server. Examples and saved passes still work.
- **Code check:** passed
- **Shipped:** Sign-in isn't set up right on this server. Examples and saved passes still work.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Sign-in is misconfigured on this server right now. / Examples and saved passes still work without sign-in.

#### `signin.err.verify`: unchanged

`src/lib/accounts/signin-errors.ts:14` · error message, 2 short sentences · max 70 characters

- **Old:** That sign-in link didn't work. Please try again.
- **Gemma:** That sign-in link didn't work. Please try again.
- **Code check:** passed
- **Shipped:** That sign-in link didn't work. Please try again.
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** The sign-in link didn't work; try again.

#### `signin.err.general`: accepted

`src/lib/accounts/signin-errors.ts:16` · error message, 1-2 short sentences · max 70 characters

- **Old:** Sign-in didn't work this time. Please give it another try.
- **Gemma:** Sign-in didn't work this time. Give it another try.
- **Code check:** passed
- **Shipped:** Sign-in didn't work this time. Give it another try.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Sign-in failed for an unknown reason; try again.

#### `signin.page.heading`: accepted

`src/app/signin/page.tsx:70` · card heading on the sign-in page, 12 words or fewer · max 70 characters

- **Old:** Sign in to make new passes and tell us what you found
- **Gemma:** Sign in to make new passes and report your finds
- **Code check:** passed
- **Shipped:** Sign in to make new passes and report your finds
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Signing in lets a grown-up make new passes and report what they found.

#### `signin.why.1`: rejected

`src/app/signin/page.tsx:81` · bullet under "Why sign in?", 2 sentences · max 140 characters

- **Old:** Only to make a new pass (2 a day) or to tell us what you found. Examples, shared links and printing work without it.
- **Gemma:** Sign in to make 2 a day or report finds. Browsing, examples, shared links and printing are open to everyone.
- **Code check:** passed
- **Shipped:** Only to make a new pass (2 a day) or to tell us what you found. Examples, shared links and printing work without it.
- **Why:** Garbled: 'Sign in to make 2 a day'.
- **FACTS:** Browsing, examples, shared links and printing need no sign-in. A NEW pass needs a grown-up signed in: 2 new passes a day each (ACCOUNT_PASSES_PER_DAY), reset at midnight Dallas time. / Signed-in grown-ups can also report what they found. · KEEP: "2 a day"

#### `signin.privacy.link`: accepted

`src/app/signin/page.tsx:90` · link to the privacy section, 12 words or fewer, light humor welcome · max 70 characters

- **Old:** What we keep (spoiler: very little), and for how long
- **Gemma:** What we keep (spoiler: not much) and for how long
- **Code check:** passed
- **Shipped:** What we keep (spoiler: not much) and for how long
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Links to the About page privacy section: what is kept and for how long.

#### `signin.card.body`: rejected

`src/components/account/SignInCard.tsx:99` · sign-in card paragraph, 2-3 sentences, before a sentence code adds · max 180 characters

- **Old:** Each new pass wakes up a real AI model, so a grown-up signs in first: 2 new passes a day each. Examples and saved passes need no sign-in.
- **Gemma:** Each new pass uses a real AI model, so grown-ups sign in first for 2 new passes a day. Examples and saved passes need no sign-in.
- **Code check:** passed
- **Shipped:** Each new pass wakes up a real AI model, so a grown-up signs in first: 2 new passes a day each. Examples and saved passes need no sign-in.
- **Why:** Loses the 'wakes up a real AI model' line.
- **FACTS:** Each new pass is a real (paid) AI model call. / Browsing, examples, shared links and printing need no sign-in. A NEW pass needs a grown-up signed in: 2 new passes a day each (ACCOUNT_PASSES_PER_DAY), reset at midnight Dallas time. · KEEP: "AI", "2 new passes a day"

#### `signin.judge.unknown`: rejected

`src/components/account/SignInCard.tsx:48` · status line, 1 sentence · max 80 characters

- **Old:** We couldn't check how many judge passes are left today right now.
- **Gemma:** We can't check how many judge passes are left today.
- **Code check:** passed
- **Shipped:** We couldn't check how many judge passes are left today right now.
- **Why:** Drops 'right now' (the failure is temporary).
- **FACTS:** Shown when the count of judge passes left today can't be read.

#### `account.privacy`: accepted

`src/lib/accounts/config.ts:104` · privacy line on the sign-in card and pages, 2 sentences · max 120 characters

- **Old:** We only keep a scrambled ID to count your 2 passes a day and your found-it reports. No email, no name.
- **Gemma:** We only keep a scrambled ID to count your 2 passes a day and reports. No email, no name.
- **Code check:** passed
- **Shipped:** We only keep a scrambled ID to count your 2 passes a day and reports. No email, no name.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** We keep only a scrambled ID, to count your 2 passes a day and your reports. / No email, no name. · KEEP: "scrambled ID", "2 passes a day", "No email, no name"

#### `account.grownups`: accepted

`src/lib/accounts/config.ts:105` · 1 short sentence · max 60 characters

- **Old:** Sign-in is for parents and teachers, not kids.
- **Gemma:** Sign-in is for grown-ups, not kids.
- **Code check:** passed
- **Shipped:** Sign-in is for grown-ups, not kids.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Sign-in is for grown-ups (parents and teachers), not kids.

#### `account.limit`: accepted

`src/lib/accounts/config.ts:107` · limit message, 2 sentences · max 170 characters

- **Old:** That's your {n} new passes for today. Your passes and the examples still work, and you get {n} more after midnight (Dallas time).
- **Gemma:** You used your {n} new passes for today. Saved passes and examples still work. You get {n} more after midnight Dallas time.
- **Code check:** passed
- **Shipped:** You used your {n} new passes for today. Saved passes and examples still work. You get {n} more after midnight Dallas time.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** {n} is filled in by code (2). / Your saved passes and the examples still work. / New passes again after midnight Dallas time. · KEEP: "midnight", "Dallas time"

#### `account.judgeNote`: accepted

`src/lib/accounts/config.ts:108` · note under the judge button, 1 sentence · max 95 characters

- **Old:** Try as a judge signs you in to a shared demo account: no sign-up, nothing to type.
- **Gemma:** Try as a judge to use a shared demo account. No sign-up, nothing to type.
- **Code check:** passed
- **Shipped:** Try as a judge to use a shared demo account. No sign-up, nothing to type.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** "Try as a judge" signs you in to a shared demo account: no sign-up, nothing to type. · KEEP: "Try as a judge", "shared demo account"

#### `account.notConfigured`: accepted

`src/lib/accounts/config.ts:109` · message, 2 sentences · max 130 characters

- **Old:** Sign-in isn't set up on this server yet, so it can't make new passes. The examples and saved passes still work.
- **Gemma:** Sign-in isn't set up here yet, so we can't make new passes. Examples and saved passes still work.
- **Code check:** passed
- **Shipped:** Sign-in isn't set up here yet, so we can't make new passes. Examples and saved passes still work.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** This server has no sign-in set up, so it can't make new passes. / Examples and saved passes still work.

### / (home)

#### `maker.signedin`: accepted

`src/components/pass/PassMaker.tsx:67` · screen-reader announcement after sign-in, 2 short sentences · max 50 characters

- **Old:** Signed in. You can make this pass now.
- **Gemma:** Signed in. You can make the pass now.
- **Code check:** passed
- **Shipped:** Signed in. You can make the pass now.
- **Why:** Tiny change.
- **FACTS:** The grown-up is now signed in and can make the pass.

### /pass/[id] and its print page

#### `pass.printline`: accepted

`src/app/pass/[id]/page.tsx:52` · line next to the Print pass button, 2 sentences · max 110 characters

- **Old:** One black-and-white page. Cut it in half: the kid gets the hunt, you get the answers.
- **Gemma:** One black-and-white page. Cut it in half: kids get the hunt, you get the answers.
- **Code check:** passed
- **Shipped:** One black-and-white page. Cut it in half: kids get the hunt, you get the answers.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** One black-and-white page. / Cut in half: the kid gets the hunt, the grown-up gets the answers.

#### `pass.reports.in`: rejected

`src/components/pass/PassPreview.tsx:66` · intro above the report buttons (signed in), 2 sentences · max 170 characters

- **Old:** Back from the park? Tap what you found. It helps the next family, and a find nobody can spot (or that isn't safe) gets left off new passes.
- **Gemma:** Back from the park? Tap what you found. It helps the next family by removing things that aren't safe or can't be spotted.
- **Code check:** passed
- **Shipped:** Back from the park? Tap what you found. It helps the next family, and a find nobody can spot (or that isn't safe) gets left off new passes.
- **Why:** Over-simple: one tap does not remove a find (it takes 3 different visitors, or 2 'not safe').
- **FACTS:** Signed-in grown-ups tap Found it / Didn't find it / Not safe for each find. / Reports help the next family: a find nobody can spot, or that isn't safe, is left off new passes for that park.

#### `report.thanks`: accepted

`src/lib/reports/kinds.ts:26` · confirmation after a report, 3 words or fewer · max 25 characters

- **Old:** Thanks — counted.
- **Gemma:** Thanks, counted!
- **Code check:** passed
- **Shipped:** Thanks, counted!
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** The report was counted.

#### `report.duplicate`: accepted

`src/lib/reports/kinds.ts:27` · message, 2 short sentences · max 60 characters

- **Old:** You already reported this find today. Thanks!
- **Gemma:** You already reported this today. Thanks!
- **Code check:** passed
- **Shipped:** You already reported this today. Thanks!
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** You already reported this find today, so it isn't counted twice.

#### `report.judgeLogged`: accepted

`src/lib/reports/kinds.ts:29` · message, 2 sentences · max 110 characters

- **Old:** Thanks! Judge demo reports are logged for us to review, but they don't change passes or the counts.
- **Gemma:** Thanks! Judge demo reports are logged for review, but they don't change the counts or passes.
- **Code check:** passed
- **Shipped:** Thanks! Judge demo reports are logged for review, but they don't change the counts or passes.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Judge demo reports are only logged for review; they never change passes or counts.

#### `report.judgeDuplicate`: accepted

`src/lib/reports/kinds.ts:30` · message, 2 short sentences · max 80 characters

- **Old:** You already sent that one from this browser today. Try another find.
- **Gemma:** This browser already sent that report today. Try another find.
- **Code check:** passed
- **Shipped:** This browser already sent that report today. Try another find.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** This browser already sent that report today.

#### `print.lead`: edited

`src/app/pass/[id]/print/page.tsx:60` · screen-only instructions above the printable page, 3 short sentences; keep the print setting words exactly · max 200 characters

- **Old:** Here's your pass: one Letter page, black and white. In the print box, pick {scale} (or "Default"). Then cut on the dashed line: the kid takes the hunt, you keep the answer key.
- **Gemma:** One black and white Letter page. In the print box, pick {scale} or "Default". Cut on the dashed line: kid gets the hunt, you keep the answer key.
- **Code check:** passed
- **Shipped:** One black-and-white Letter page. In the print box, pick {scale} or "Default". Cut on the dashed line: kid gets the hunt, you keep the answer key. _(Gemma draft, edited)_
- **Why:** Gemma draft, edited: 'black and white' -> 'black-and-white'.
- **FACTS:** {scale} is the bold words "Scale: 100%", filled in by code. / One US Letter page, black and white. / Cut on the dashed line: the kid takes the hunt, the grown-up keeps the answer key. · KEEP: "Letter", ""Default"", "dashed line"

#### `stub.cutline`: accepted

`src/components/pass/ParentStub.tsx:44` · tiny printed text on the cut line, 11 words or fewer · max 60 characters

- **Old:** cut here · kid keeps the top, grown-up keeps the bottom
- **Gemma:** cut here: top for kids, bottom for grown-ups
- **Code check:** passed
- **Shipped:** cut here: top for kids, bottom for grown-ups
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Cut here: the kid keeps the top, the grown-up keeps the bottom.

### messages (errors, limits, empty states)

#### `notfound.body`: rejected

`src/app/not-found.tsx:14` · 404 page text, 2 sentences, light humor welcome · max 120 characters

- **Old:** There's no page at this address (maybe a typo). Good news: the parks are right where you left them.
- **Gemma:** We can't find this page (maybe a typo). The parks are still where you left them.
- **Code check:** passed
- **Shipped:** There's no page at this address (maybe a typo). Good news: the parks are right where you left them.
- **Why:** Drops 'Good news:', the joke's set-up.
- **FACTS:** There is no page at this address.

#### `passgone.lead`: accepted

`src/app/pass/[id]/not-found.tsx:15` · 1 short sentence before the fixed no-data line, light humor welcome · max 50 characters

- **Old:** This pass seems to have wandered off.
- **Gemma:** This pass wandered off.
- **Code check:** passed
- **Shipped:** This pass wandered off.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** The pass isn't here.

#### `pass.allEmpty`: edited

`src/lib/pass/schema.ts:166` · empty state, 2 sentences, starts with "No data available for {park}" · max 170 characters

- **Old:** No data available for {park} yet: no mapped features and no recent wildlife sightings. Try a bigger park nearby from the list.
- **Gemma:** No data available for {park}. We found no mapped features or wildlife sightings here. Try a bigger park from the list.
- **Code check:** passed
- **Shipped:** No data available for {park}. We found no mapped features or recent wildlife sightings here. Try a bigger park from the list. _(Gemma draft, edited)_
- **Why:** Gemma draft, edited: put back 'recent' (the park may have older sightings).
- **FACTS:** {park} is filled in by code. / The park has no mapped features and no recent wildlife sightings. / Suggest a bigger park nearby from the list. · KEEP: "No data available for {park}"

#### `pass.notAPark`: unchanged

`src/lib/pass/schema.ts:167` · error, 2 short sentences · max 90 characters

- **Old:** We couldn't read that park on OpenStreetMap. Pick another park from the list.
- **Gemma:** We couldn't read that park on OpenStreetMap. Pick another park from the list.
- **Code check:** passed
- **Shipped:** We couldn't read that park on OpenStreetMap. Pick another park from the list.
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** The park couldn't be read on OpenStreetMap; pick another from the list. · KEEP: "OpenStreetMap"

#### `pass.paused`: accepted

`src/lib/pass/schema.ts:168` · limit message, 2 sentences · max 110 characters

- **Old:** Clue writing is paused for today (free budget used). Passes already made today still work.
- **Gemma:** Clue writing is paused for today since the free budget is used. Passes made earlier still work.
- **Code check:** passed
- **Shipped:** Clue writing is paused for today since the free budget is used. Passes made earlier still work.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** The daily model budget is used, so no new clues today. / Passes already made today still work.

#### `pass.variantLimit`: rejected

`src/lib/pass/schema.ts:170` · limit message, 2 sentences · max 170 characters

- **Old:** That's {max} different passes for this park and age today, the most we make. Print one of them, pick another park, or come back tomorrow.
- **Gemma:** That is {max} different passes for this park and age today. Print one, pick another park, or come back tomorrow.
- **Code check:** passed
- **Shipped:** That's {max} different passes for this park and age today, the most we make. Print one of them, pick another park, or come back tomorrow.
- **Why:** Drops 'the most we make' (why there are no more).
- **FACTS:** {max} is filled in by code (3 different passes per park, age band and day). / Options: print one, pick another park, or come back tomorrow.

#### `parks.noPlace`: unchanged

`src/lib/parks/schema.ts:13` · search error, 2 short sentences · max 70 characters

- **Old:** We couldn't find that place. Try a town name or ZIP.
- **Gemma:** We couldn't find that place. Try a town name or ZIP.
- **Code check:** passed
- **Shipped:** We couldn't find that place. Try a town name or ZIP.
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** The place search found nothing; try a town name or ZIP.

#### `parks.geocoderDown`: accepted

`src/lib/parks/schema.ts:14` · empty state, starts with "No data available:", 2 sentences · max 120 characters

- **Old:** No data available: the map search isn't answering. Try 'Use my location' or an example park.
- **Gemma:** No data available: the map search isn't answering. Try "Use my location" or an example park.
- **Code check:** passed
- **Shipped:** No data available: the map search isn't answering. Try "Use my location" or an example park.
- **Why:** Only the quote style.
- **FACTS:** The map search (Nominatim) isn't answering. / Use my location or an example park still work. · KEEP: "Use my location"

#### `parks.noParks`: accepted

`src/lib/parks/schema.ts:15` · empty state, 1 sentence · max 60 characters

- **Old:** No parks found within 5 km in OpenStreetMap.
- **Gemma:** No parks within 5 km in OpenStreetMap.
- **Code check:** passed
- **Shipped:** No parks within 5 km in OpenStreetMap.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** No parks within 5 km in OpenStreetMap. · KEEP: "5 km", "OpenStreetMap"

#### `parks.overpassDown`: accepted

`src/lib/parks/schema.ts:17` · empty state, starts with "No data available:", 2 sentences; no fixed wait time · max 120 characters

- **Old:** No data available: the OpenStreetMap server is busy. Try again shortly, or pick an example park.
- **Gemma:** No data available: the OpenStreetMap server is busy. Try again shortly or pick an example park.
- **Code check:** passed
- **Shipped:** No data available: the OpenStreetMap server is busy. Try again shortly or pick an example park.
- **Why:** Only a comma.
- **FACTS:** The OpenStreetMap (Overpass) server is busy. / Try again shortly or pick an example park. Do not promise a wait time. · KEEP: "OpenStreetMap"

#### `parks.busyHere`: accepted

`src/lib/parks/schema.ts:22` · message, 2 short sentences · max 90 characters

- **Old:** Grass Pass is busy with other park lookups right now. Try again in a few seconds.
- **Gemma:** Grass Pass is busy with other lookups. Try again in a few seconds.
- **Code check:** passed
- **Shipped:** Grass Pass is busy with other lookups. Try again in a few seconds.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Grass Pass's own lookup slots are busy (not OpenStreetMap's fault); try again in a few seconds.

#### `parks.parkTooBig`: rejected

`src/lib/parks/schema.ts:25` · empty state, starts with "No data available:", 2 sentences · max 120 characters

- **Old:** No data available: OpenStreetMap couldn't read this park in time (it may be very big). Try a smaller park nearby.
- **Gemma:** No data available: OpenStreetMap couldn't read this park in time because it may be too big. Try a smaller park nearby.
- **Code check:** passed
- **Shipped:** No data available: OpenStreetMap couldn't read this park in time (it may be very big). Try a smaller park nearby.
- **Why:** 'because it may be' is a muddled cause.
- **FACTS:** OpenStreetMap couldn't read this park in time; it may be very big. / Try a smaller park nearby. · KEEP: "OpenStreetMap"

#### `parks.savedIndex`: accepted

`src/lib/parks/schema.ts:28` · notice above a park list, 2 sentences · max 200 characters

- **Old:** The OpenStreetMap park server didn't answer in time, so this list comes from our saved copy of OpenStreetMap parks around Dallas (see the date below). New parks may be missing.
- **Gemma:** OpenStreetMap didn't answer in time. This list is a saved copy of OpenStreetMap parks around Dallas (see date below), so new parks may be missing.
- **Code check:** passed
- **Shipped:** OpenStreetMap didn't answer in time. This list is a saved copy of OpenStreetMap parks around Dallas (see date below), so new parks may be missing.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** The live OpenStreetMap park server didn't answer in time. / This list is our saved copy of OpenStreetMap parks around Dallas; its date is shown below. / New parks may be missing. · KEEP: "OpenStreetMap", "Dallas", "date below"

#### `parks.nominatimParks`: accepted

`src/lib/parks/schema.ts:28` · notice above a park list, 2 sentences · max 180 characters

- **Old:** The OpenStreetMap park server didn't answer in time, so this list comes from the OpenStreetMap place search (Nominatim) instead. It may miss some parks.
- **Gemma:** OpenStreetMap didn't answer in time. This list uses the OpenStreetMap place search (Nominatim) instead, so it may miss some parks.
- **Code check:** passed
- **Shipped:** OpenStreetMap didn't answer in time. This list uses the OpenStreetMap place search (Nominatim) instead, so it may miss some parks.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** The live OpenStreetMap park server didn't answer in time. / This list comes from the OpenStreetMap place search (Nominatim) instead; it may miss some parks. · KEEP: "OpenStreetMap", "Nominatim"

#### `find.noGeo`: accepted

`src/components/parks/FindAPark.tsx:29` · error, 2 short sentences · max 75 characters

- **Old:** Your browser can't share a location. Type a town or ZIP instead.
- **Gemma:** Your browser can't share your location. Type a town or ZIP instead.
- **Code check:** passed
- **Shipped:** Your browser can't share your location. Type a town or ZIP instead.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** This browser can't share a location; type a town or ZIP.

#### `find.geoDenied`: accepted

`src/components/parks/FindAPark.tsx:30` · error, 2 sentences · max 120 characters

- **Old:** Location is blocked for this site. Type a town or ZIP instead, or allow location in your browser settings.
- **Gemma:** Location is blocked for this site. Type a town or ZIP, or allow location in your browser settings.
- **Code check:** passed
- **Shipped:** Location is blocked for this site. Type a town or ZIP, or allow location in your browser settings.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Location is blocked for this site; type a town or ZIP, or allow location in browser settings.

#### `find.geoFailed`: accepted

`src/components/parks/FindAPark.tsx:31` · error, 2 short sentences · max 75 characters

- **Old:** We couldn't get your location. Try again, or type a town or ZIP.
- **Gemma:** We couldn't get your location. Try again or type a town or ZIP.
- **Code check:** passed
- **Shipped:** We couldn't get your location. Try again or type a town or ZIP.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Getting the location failed; try again or type a town or ZIP.

#### `find.offline`: rejected

`src/components/parks/FindAPark.tsx:32` · error, 2 short sentences · max 90 characters

- **Old:** We couldn't reach Grass Pass. Check your internet connection and try again.
- **Gemma:** We couldn't reach Grass Pass. Check your internet and try again.
- **Code check:** passed
- **Shipped:** We couldn't reach Grass Pass. Check your internet connection and try again.
- **Why:** The same line is used in 3 files (park search, pass maker, report buttons); keep them identical.
- **FACTS:** The browser couldn't reach the Grass Pass server; check the connection and retry.

#### `find.slow`: accepted

`src/components/parks/FindAPark.tsx:34` · status while waiting, 2 sentences · max 180 characters

- **Old:** Still working: the OpenStreetMap park server can be slow. If it doesn't answer soon, we use a saved park list or the OpenStreetMap place search instead.
- **Gemma:** Still working. The OpenStreetMap park server can be slow. If it doesn't answer soon, we'll try a saved park list or the OpenStreetMap place search instead.
- **Code check:** passed
- **Shipped:** Still working. The OpenStreetMap park server can be slow. If it doesn't answer soon, we'll try a saved park list or the OpenStreetMap place search instead.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** The OpenStreetMap park server can be slow. / If it doesn't answer soon, the search falls back to a saved park list or the OpenStreetMap place search. · KEEP: "OpenStreetMap"

#### `wait.copy`: accepted

`src/components/pass/usePassRequest.ts:25` · status while a pass is made, 1 sentence · max 130 characters

- **Old:** A new pass usually takes 10-30 seconds, and up to about a minute and a half when the free map websites are slow.
- **Gemma:** A new pass usually takes 10-30 seconds, and up to a minute and a half if the free map websites are slow.
- **Code check:** passed
- **Shipped:** A new pass usually takes 10-30 seconds, and up to a minute and a half if the free map websites are slow.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** A new pass usually takes 10-30 seconds (PASS_WAIT_COPY), up to about a minute and a half when the free map websites are slow. · KEEP: "10-30 seconds", "a minute and a half"

#### `wait.timeout`: accepted

`src/components/pass/usePassRequest.ts:31` · error after the browser stops waiting, 3 sentences · max 260 characters

- **Old:** This is taking much longer than usual (over a minute and a half), so we stopped waiting. The free map and wildlife websites can be slow at busy times. Try again: if your pass got made in the meantime, it opens right away.
- **Gemma:** This is taking longer than a minute and a half, so we stopped waiting. Free map and wildlife sites can be slow when they're busy. Try again; if your pass is ready, it will open now.
- **Code check:** passed
- **Shipped:** This is taking longer than a minute and a half, so we stopped waiting. Free map and wildlife sites can be slow when they're busy. Try again; if your pass is ready, it will open now.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** The browser stopped waiting after about a minute and a half. / The free map and wildlife websites can be slow at busy times. / Retrying opens the pass at once if it was made in the meantime. · KEEP: "a minute and a half"

#### `lucky.notConnected`: accepted

`src/lib/pool/lucky.ts:128` · section message on a pass, starts with "Lucky Finds: not connected.", 2 sentences · max 140 characters

- **Old:** Lucky Finds: not connected. This server has no SerpApi key, so there are no Lucky Finds from visitor reviews.
- **Gemma:** Lucky Finds: not connected. This server has no SerpApi key, so we can't pull Lucky Finds from visitor reviews.
- **Code check:** passed
- **Shipped:** Lucky Finds: not connected. This server has no SerpApi key, so we can't pull Lucky Finds from visitor reviews.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** This server has no SerpApi key, so no Lucky Finds from visitor reviews. · KEEP: "Lucky Finds: not connected.", "SerpApi"

#### `lucky.dailyCap`: accepted

`src/lib/pool/lucky.ts:129` · section message on a pass, starts with "Lucky Finds: off for today.", 2 sentences · max 160 characters

- **Old:** Lucky Finds: off for today. Grass Pass has used its free search limit for visitor reviews (SerpApi); it resets at midnight Dallas time.
- **Gemma:** Lucky Finds: off for today. We hit the free SerpApi search limit for visitor reviews. It resets at midnight Dallas time.
- **Code check:** passed
- **Shipped:** Lucky Finds: off for today. We hit the free SerpApi search limit for visitor reviews. It resets at midnight Dallas time.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** The free daily SerpApi search limit is used; it resets at midnight Dallas time. · KEEP: "Lucky Finds: off for today.", "SerpApi", "midnight Dallas time"

#### `lucky.down`: accepted

`src/lib/pool/lucky.ts:134` · section message, starts with "No data available:", 1 sentence · max 110 characters

- **Old:** No data available: Google reviews (via SerpApi) didn't answer, so there are no Lucky Finds on this pass.
- **Gemma:** No data available: SerpApi didn't answer for Google reviews, so there are no Lucky Finds on this pass.
- **Code check:** passed
- **Shipped:** No data available: SerpApi didn't answer for Google reviews, so there are no Lucky Finds on this pass.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Google reviews via SerpApi didn't answer; no Lucky Finds on this pass. · KEEP: "SerpApi", "Lucky Finds"

#### `wild.down`: rejected

`src/lib/pool/wild.ts:118` · section message, starts with "No data available:", 2 sentences · max 150 characters

- **Old:** No data available: iNaturalist (the wildlife sightings service) didn't answer when this pass was made. Trying again in a minute may help.
- **Gemma:** No data available: iNaturalist didn't answer when this pass was made. Trying again in a minute may help.
- **Code check:** passed
- **Shipped:** No data available: iNaturalist (the wildlife sightings service) didn't answer when this pass was made. Trying again in a minute may help.
- **Why:** Drops what iNaturalist is; most parents won't know.
- **FACTS:** iNaturalist (the wildlife sightings service) didn't answer when this pass was made. / Trying again in a minute may help. · KEEP: "iNaturalist", "in a minute"

#### `spot.noLandmark`: rejected

`src/lib/spot/types.ts:92` · section message, starts with "No Find This Spot today:", 1 sentence · max 100 characters

- **Old:** No Find This Spot today: this park has no single landmark on the map (OpenStreetMap).
- **Gemma:** No Find This Spot today: OpenStreetMap doesn't show a single landmark for this park.
- **Code check:** passed
- **Shipped:** No Find This Spot today: this park has no single landmark on the map (OpenStreetMap).
- **Why:** Reads as 'no landmark at all' (the rule is: no landmark the park has only one of).
- **FACTS:** This park has no landmark it has only one of on OpenStreetMap, so no Find This Spot. · KEEP: "No Find This Spot today:", "OpenStreetMap"

#### `spot.busy`: accepted

`src/lib/spot/types.ts:92` · section message, starts with "No Find This Spot today:", 2 sentences · max 130 characters

- **Old:** No Find This Spot today: the OpenStreetMap server was busy, so we couldn't draw the map. Make a different pass to try again.
- **Gemma:** No Find This Spot today: the OpenStreetMap server was busy and we couldn't draw the map. Make a different pass to try again.
- **Code check:** passed
- **Shipped:** No Find This Spot today: the OpenStreetMap server was busy and we couldn't draw the map. Make a different pass to try again.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** The OpenStreetMap server was busy, so the map couldn't be drawn. / Pressing "Make a different pass" tries again. · KEEP: "No Find This Spot today:", "OpenStreetMap", "Make a different pass"

#### `datatooslow`: accepted

`src/lib/pass/park-data.ts:47` · error, 2 sentences · max 120 characters

- **Old:** The park data took too long to load, so there was no time left to write clues. Try again shortly.
- **Gemma:** The park data took too long to load, so we ran out of time to write clues. Try again shortly.
- **Code check:** passed
- **Shipped:** The park data took too long to load, so we ran out of time to write clues. Try again shortly.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** Park data took too long, leaving no time to write clues; try again shortly.

### / (home)

#### `showcase.nofinds`: accepted

`src/lib/home/showcase.ts:102` · example card line, starts with "No data available:", 1 sentence · max 80 characters

- **Old:** No data available: this pass has no finds that passed our checks.
- **Gemma:** No data available: none of the finds on this pass passed our checks.
- **Code check:** passed
- **Shipped:** No data available: none of the finds on this pass passed our checks.
- **Why:** True, on tone, at least as clear as before.
- **FACTS:** No find on this example pass passed the checks.

### README.md (first screen)

#### `readme.tagline`: unchanged

`README.md:3` · one-line tagline under the title, 12 words or fewer · max 70 characters

- **Old:** Your ticket to get outside. Pick a park. Print a pass. Phone away.
- **Gemma:** Your ticket to get outside. Pick a park. Print a pass. Phone away.
- **Code check:** passed
- **Shipped:** Your ticket to get outside. Pick a park. Print a pass. Phone away.
- **Why:** Gemma returned the current text unchanged.
- **FACTS:** Grass Pass: pick a park, print a pass, put the phone away. The logo line is "Your ticket to get outside." · KEEP: "Your ticket to get outside."

#### `readme.intro`: rejected

`README.md:10` · intro paragraph for developers and judges, 5-6 sentences · max 640 characters

- **Old:** Grass Pass turns your local park into a one-page treasure hunt in about 30 seconds. Pick a park and your kid's age (4-6, 6-10 or 10-13). Code collects what is really in that park. Gemma 4 (open weights, Apache-2.0, on DigitalOcean) picks a fair mix and writes kid-level clues, usually in one call (plus one refill call if too few pass). Code then fact-checks every clue against its source, drops any that fail, and writes every number, date and safety line itself. You print one black-and-white page: the kid ticks boxes with a pencil; you keep a tear-off stub with the answers, safety notes and sources. The phone stays in your pocket.
- **Gemma:** Grass Pass creates a one-page treasure hunt in about 30 seconds. Pick a park and an age band: 4-6, 6-10, or 10-13. Our AI, Gemma 4 (Apache-2.0, on DigitalOcean), writes kid-level clues based on real park data. Usually, it takes one call, with a refill call if needed. Code fact-checks every clue and removes failures. Code also writes every number, date, and safety line. You print one black-and-white page. Kids use pencils to tick boxes while you keep a tear-off stub with the answers. The phone stays home.
- **Code check:** passed
- **Shipped:** Grass Pass turns your local park into a one-page treasure hunt, usually in 10-30 seconds (up to about a minute and a half for a big park or a slow model; measured, see [Limitations](#limitations)). Pick a park and your kid's age (4-6, 6-10 or 10-13). Code collects what is really in that park. Gemma 4 (open weights, Apache-2.0, on DigitalOcean) picks a fair mix and writes kid-level clues, usually in one call (at most 3: a retry if the first call fails, refills if too few pass). Code then fact-checks every clue against its source, drops any that fail, and writes every number, date and safety line itself. You print one black-and-white page: the kid ticks boxes with a pencil; you keep a tear-off stub with the answers, safety notes and sources. The phone stays in your pocket.
- **Why:** Drops 'open weights', 'a fair mix' and 'what is really in that park'. Old text kept, then: Fact fix after the rebase onto main b5a862b (not Gemma): a pass now makes 1-3 model calls (MAX_MODEL_CALLS = 3), so 'once more' / 'one refill' is no longer true. Fact fix (judge round 6, Builder AA, not Gemma): 'in about 30 seconds' undersold the slow cases (a judge's big-park pass took about 57 s plus an 11.6 s search), so it now says the measured range.
- **FACTS:** The AI model is Gemma 4 (gemma-4-31B-it), Google's open-weight model (Apache-2.0), run on DigitalOcean serverless inference in the US. / Age bands are exactly 4-6, 6-10 and 10-13 (AGE_BAND_INFO). / A pass usually takes 10-30 seconds (about 30 seconds). / Up to about a minute and a half for a big park or a slow model (a judge's big-park pass took about 57 s plus an 11.6 s search). / Usually one model call; at most 3 (one whole retry if the first call fails, refills if too few clues pass). / Code checks every clue against its source and removes any that fail; the model never decides what is safe. / Code writes every number, date and safety line. / One black-and-white page; the kid ticks boxes with a pencil; the grown-up keeps a tear-off stub with answers, safety notes and sources. · KEEP: "Gemma 4", "Apache-2.0", "DigitalOcean", "4-6", "6-10", "10-13", "30 seconds"

#### `readme.nodata`: rejected

`README.md:29` · one sentence (bold markdown is added by code around the quoted words) · max 110 characters

- **Old:** If a source has nothing, the pass says "No data available" and why. It never pads the pass with generic items.
- **Gemma:** We never use generic filler; if a source is empty, the pass says No data available and explains why.
- **Code check:** passed
- **Shipped:** If a source has nothing, the pass says "No data available" and why. It never pads the pass with generic items.
- **Why:** Lost the quotes around No data available.
- **FACTS:** Missing data is never faked: the site says "No data available" and why. / Passes are never padded with generic items.
