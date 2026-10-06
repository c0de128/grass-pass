/**
 * R1-m7 (SEC-1-04): text printed for a child never carries a way to contact someone. Bare domains
 * ("kidsprize.com", "x.com"), @handles, and phone-like runs of 7+ digits (spaces, dots, dashes and
 * brackets between them allowed: "555 0100", "(214) 555-0100").
 * R2-m3 (SEC-2-04): any top-level domain, not a fixed list ("prize.ru", "win.ai", "kids.dev"): a word, a
 * dot, then 2-24 letters that are all lower case or all upper case ("pond.Look" from a missing space is
 * not a domain; "e.g." and "a.m." have one-letter parts). Also spelled or bracketed dots:
 * "kidsprize dot com", "kidsprize (dot) net", "kidsprize[.]ru".
 * R3 (SEC-3-07): the text is NFKC-normalized first (full-width "．" and "＠" become "." and "@"; the
 * ideographic "。" is mapped to "." too); a title-case common TLD ("Kidsprize.Com"); spaces around a dot
 * before a common TLD ("kidsprize . com"); and "(at)" ("kidsprize(at)gmail").
 *
 * No imports: this module is used by client components (park search list, age step) as well as the
 * server-side output checks (src/lib/ai/validate.ts re-exports it).
 */
const MARKUP_RE = /https?:|www\.|<|>|\]\(|\bjavascript:/i;
const DOMAIN_RE = /(?<![\p{L}\p{N}])[\p{L}\p{N}][\p{L}\p{N}-]*\.(?:\p{Ll}{2,24}|\p{Lu}{2,24})(?![\p{L}\p{N}])/u;
const COMMON_TLDS = "com|net|org|edu|gov|io|co|us|uk|ca|ru|cn|de|fr|in|ai|dev|app|me|info|biz|xyz|gg|tv|cc|to|ly|link|site|online|shop|store|club|live|fun|top|win|vip";
/** Title-case TLDs that are not everyday words, so a missing space ("pond.In the grass") is not a domain. */
const TITLE_TLDS = ["com", "net", "org", "edu", "gov", "io", "ru", "cn", "uk", "ai", "dev", "info", "biz", "xyz", "gg", "tv", "cc", "ly"]
  .map((t) => t[0].toUpperCase() + t.slice(1))
  .join("|");
const SPELLED_DOT_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])[\\p{L}\\p{N}][\\p{L}\\p{N}-]*\\s*(?:[([{]\\s*(?:dot|\\.)\\s*[)\\]}]\\s*\\p{L}{2,24}|dot\\s+(?:${COMMON_TLDS}))(?![\\p{L}\\p{N}])`,
  "iu",
);
/** "Kidsprize.Com": a title-case TLD, only from the common list ("pond.Look" stays fine). */
const TITLE_TLD_RE = new RegExp(`(?<![\\p{L}\\p{N}])[\\p{L}\\p{N}][\\p{L}\\p{N}-]*\\.(?:${TITLE_TLDS})(?![\\p{L}\\p{N}])`, "u");
/**
 * "kidsprize . com" / "kidsprize .com": a space before the dot, then a common TLD in any case. The word
 * needs 2+ characters and the TLD must end the word ("co-op").
 */
const SPACED_DOT_RE = new RegExp(`(?<![\\p{L}\\p{N}])[\\p{L}\\p{N}][\\p{L}\\p{N}-]+\\s+\\.\\s*(?:${COMMON_TLDS})(?![\\p{L}\\p{N}-])`, "iu");
/**
 * "kidsprize. com": a space only after the dot. Only TLDs that are not everyday words, in lower case,
 * so "etc. in the meadow" or "the slide. Me too" stay fine.
 */
const SPACE_AFTER_DOT_RE = /(?<![\p{L}\p{N}])[\p{L}\p{N}][\p{L}\p{N}-]+\.\s+(?:com|net|org|ru|io|xyz|biz|cn)(?![\p{L}\p{N}-])/u;
/** "kidsprize(at)gmail", "kidsprize [at] gmail". */
const SPELLED_AT_RE = /[\p{L}\p{N}]\s*[([{]\s*at\s*[)\]}]\s*[\p{L}\p{N}]/iu;
const HANDLE_RE = /(?:^|[^\p{L}\p{N}])@[\p{L}\p{N}_]{2,}/u;
const DIGITS_RE = /\d(?:[\s().-]*\d){6,}/;

/** NFKC, plus the ideographic full stops NFKC keeps ("。", "｡" become "."). */
export function normalizeForContact(s: string): string {
  return s.normalize("NFKC").replace(/[。｡]/g, ".");
}

export const hasUrlOrMarkup = (raw: string): boolean => {
  const s = normalizeForContact(raw);
  return (
    MARKUP_RE.test(s) ||
    DOMAIN_RE.test(s) ||
    SPELLED_DOT_RE.test(s) ||
    TITLE_TLD_RE.test(s) ||
    SPACED_DOT_RE.test(s) ||
    SPACE_AFTER_DOT_RE.test(s) ||
    SPELLED_AT_RE.test(s) ||
    HANDLE_RE.test(s) ||
    DIGITS_RE.test(s)
  );
};

/** Shown instead of a park name that fails `hasUrlOrMarkup` (R2-m3), together with HIDDEN_PARK_NOTE. */
export const HIDDEN_PARK_LABEL = "This park";
export const HIDDEN_PARK_NOTE = "We hid this park's name: on OpenStreetMap it looked like it had a web address, an @handle or a phone number in it.";

/**
 * R2-m3 (SEC-2-04): the park name from OpenStreetMap is printed on the pass, so it gets the same contact
 * check as every other printed text. An unsafe name becomes a neutral label (and the pass says why).
 * SEC-3-07: also used on screen (park search results, the age step).
 */
export function safeParkName(name: string): { name: string; hidden: boolean } {
  return hasUrlOrMarkup(name) ? { name: HIDDEN_PARK_LABEL, hidden: true } : { name, hidden: false };
}
