/**
 * Stable, diff-friendly JSON for fixtures and results: objects and arrays near the top are spread
 * over lines; anything nested deeper than INLINE_DEPTH (one Overpass element, one species row) stays
 * on one line so big recordings stay readable and small.
 */
export const INLINE_DEPTH = 5;

export function prettyJson(value: unknown, inlineDepth = INLINE_DEPTH): string {
  const walk = (v: unknown, depth: number, indent: string): string => {
    if (v === null || typeof v !== "object" || depth >= inlineDepth) return JSON.stringify(v) ?? "null";
    const next = indent + " ";
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      return `[\n${v.map((x) => next + walk(x, depth + 1, next)).join(",\n")}\n${indent}]`;
    }
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([k, x]) => `${next}${JSON.stringify(k)}: ${walk(x, depth + 1, next)}`).join(",\n")}\n${indent}}`;
  };
  return `${walk(value, 0, "")}\n`;
}
