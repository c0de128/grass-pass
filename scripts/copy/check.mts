/**
 * Code check for Gemma's copy drafts (docs/COPY-BY-GEMMA.md). Pure functions, no network, no server-only
 * imports, so unit tests (tests/unit/copy-check.test.ts) run them directly.
 *
 * A draft is rejected (the current text stays) when it:
 *  - is empty, or longer than the block's limit;
 *  - drops or adds a {placeholder} (code fills those in: numbers, model names, links);
 *  - drops any exact `keep` string (numbers, names, "No data available", safety words);
 *  - adds a number (digits or a number word) that is not in the current text or the block's FACTS;
 *  - adds a capitalised name that is not in the current text, the FACTS or a short list of site words;
 *  - uses a banned hype word, an emoji, or markup.
 */

export type CopyBlock = {
  /** Stable id, e.g. "home.how.s2.body". */
  id: string;
  /** Where it shows, e.g. "/ (home)". */
  page: string;
  /** Repo-relative file the text lives in. */
  file: string;
  /** What the text is for, with its size, e.g. "card title, 6 words or fewer". */
  role: string;
  maxChars: number;
  /** The current text. {name} marks a value code fills in (a number, a link, a model id). */
  text: string;
  /** The true facts this block must keep, written from the code and eval files. */
  facts: readonly string[];
  /** Exact strings the draft must contain (numbers, names, safety words). Placeholders are checked separately. */
  keep?: readonly string[];
};

export type CheckResult = { ok: boolean; reasons: string[] };

export const BANNED_WORDS: readonly string[] = [
  "revolutionary",
  "revolutionize",
  "revolutionise",
  "magic",
  "magical",
  "seamless",
  "seamlessly",
  "cutting-edge",
  "game-changer",
  "game-changing",
  "unleash",
  "effortless",
  "effortlessly",
  "supercharge",
  "ultimate",
  "world-class",
  "best-in-class",
  "groundbreaking",
  "state-of-the-art",
  "next-level",
  "delve",
  "elevate",
  "empower",
  "unlock",
  "harness",
  "guarantee",
  "guaranteed",
  "forever",
  "always free",
  "100%",
  "perfect",
  "flawless",
  "instantly",
];

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "hundred",
  "thousand",
  "dozen",
  "half",
  "once",
  "twice",
];

/**
 * Capitalised words that may start a phrase anywhere on this site without being a new "fact" (UI words the
 * site already uses in buttons and section names). A name not here, not in the current text and not in
 * FACTS is treated as a new proper noun.
 */
export const SITE_WORDS: readonly string[] = ["Grass", "Pass", "AI", "OK", "I", "No", "Yes", "Print", "Tap", "Sign", "Make", "Try"];

const PLACEHOLDER_RE = /\{[a-zA-Z][a-zA-Z0-9]*\}/g;

export function placeholders(text: string): string[] {
  return (text.match(PLACEHOLDER_RE) ?? []).sort();
}

/** Digit groups ("10-30" -> 10, 30; "1,321" -> 1321; "1.5" -> 1.5). */
export function numbersIn(text: string): string[] {
  return (text.replace(PLACEHOLDER_RE, " ").match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
}

/** Capitalised words that do not start a sentence (or a clause after ":" / a quote / a dash). */
export function properNouns(text: string): string[] {
  const out: string[] = [];
  const clean = text.replace(PLACEHOLDER_RE, " x ");
  const re = /[A-Za-z][A-Za-z0-9'’-]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const w = m[0];
    // "iNaturalist", "OpenStreetMap", "SerpApi": inner capitals mark a name wherever it stands.
    const innerCaps = /[A-Z]/.test(w.slice(1)) && /[a-z]/.test(w);
    if (!/^[A-Z]/.test(w) && !innerCaps) continue;
    const before = clean.slice(0, m.index).replace(/[\s"“”‘’'(\[*_]+$/, "");
    const atStart = before === "" || /[.!?:;—–…·|-]$/.test(before);
    if (!atStart || innerCaps) out.push(w.replace(/['’]s$/, ""));
  }
  return out;
}

const EMOJI_RE = /\p{Extended_Pictographic}/u;

/** Check one Gemma draft against its block. */
export function checkDraft(block: CopyBlock, draft: string): CheckResult {
  const reasons: string[] = [];
  const text = draft.trim();
  if (!text) return { ok: false, reasons: ["empty draft"] };
  if (text.length > block.maxChars) reasons.push(`too long: ${text.length} > ${block.maxChars} characters`);

  const want = placeholders(block.text);
  const got = placeholders(text);
  if (want.join("|") !== got.join("|")) reasons.push(`placeholders changed: wanted [${want.join(", ")}], got [${got.join(", ")}]`);

  const keep = [...(block.keep ?? [])];
  if (block.text.includes("No data available") && !keep.includes("No data available")) keep.push("No data available");
  for (const k of keep) if (!text.includes(k)) reasons.push(`dropped a fact: "${k}"`);

  const source = [block.text, ...block.facts, ...keep].join(" \n ");
  const knownNumbers = new Set(numbersIn(source));
  const newNumbers = numbersIn(text).filter((n) => !knownNumbers.has(n));
  if (newNumbers.length > 0) reasons.push(`new number(s) not in FACTS: ${[...new Set(newNumbers)].join(", ")}`);

  const sourceWords = new Set(words(source));
  const newNumberWords = words(text).filter((w) => NUMBER_WORDS.includes(w) && !sourceWords.has(w));
  if (newNumberWords.length > 0) reasons.push(`new number word(s) not in FACTS: ${[...new Set(newNumberWords)].join(", ")}`);

  // A capitalised word counts as a new name only if the word (in any case) is nowhere in the source: "Park"
  // for "park" is a capital letter, not a new fact; "Yellowstone" is a new fact.
  const knownLower = new Set([...SITE_WORDS, ...(source.match(/[A-Za-z][A-Za-z0-9'’-]*/g) ?? [])].map((w) => w.replace(/['’]s$/, "").toLowerCase()));
  const newNames = properNouns(text).filter((w) => !knownLower.has(w.toLowerCase()));
  if (newNames.length > 0) reasons.push(`new name(s) not in FACTS: ${[...new Set(newNames)].join(", ")}`);

  const lower = ` ${text.toLowerCase()} `;
  const banned = BANNED_WORDS.filter((b) => new RegExp(`(^|[^a-z])${b.replace(/[.*+?^${}()|[\]\\%]/g, "\\$&")}([^a-z]|$)`).test(lower));
  if (banned.length > 0) reasons.push(`banned word(s): ${banned.join(", ")}`);
  if (EMOJI_RE.test(text)) reasons.push("emoji");
  if (/<[a-z/][^>]*>|\*\*|__|`/.test(text)) reasons.push("markup (HTML, markdown or backticks)");
  return { ok: reasons.length === 0, reasons };
}

/** The JSON schema Gemma must answer with for one batch (strict structured output). */
export function batchJsonSchema(ids: readonly string[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["drafts"],
    properties: {
      drafts: {
        type: "array",
        minItems: ids.length,
        maxItems: ids.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "text"],
          properties: { id: { type: "string", enum: [...ids] }, text: { type: "string" } },
        },
      },
    },
  };
}

/**
 * The applied copy must really be in the file (catches a review log that says "shipped" for text nobody
 * applied). JSX entities and line wraps are normalised; a {placeholder} matches anything.
 */
export function normaliseSource(src: string): string {
  return src
    .replace(/\{"\s"\}|\{" "\}/g, " ")
    .replace(/<\/?(?:strong|em|code)\b[^>]*>/g, "")
    .replace(/&apos;|&rsquo;|&#39;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/[“”]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ");
}

export function textIsInSource(text: string, src: string): boolean {
  const norm = normaliseSource(src);
  const parts = normaliseSource(text)
    .split(PLACEHOLDER_RE)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3);
  return parts.every((p) => norm.includes(p));
}
