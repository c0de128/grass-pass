/**
 * Eval settings come from environment variables (Vitest owns argv). Keys are read from the process
 * env or .env.local and are never printed.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { APP_ROOT } from "./fixture";

/** "a, b,,c" -> ["a","b","c"]; empty/undefined -> null. */
export function envList(raw: string | undefined): string[] | null {
  const items = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

/** KEY=VALUE lines of a dotenv file (no expansion). Comments and blank lines are skipped. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** process.env over .env.local (process.env wins). */
export function evalEnv(root = APP_ROOT): Record<string, string | undefined> {
  const file = path.join(root, ".env.local");
  const local = existsSync(file) ? parseDotenv(readFileSync(file, "utf8")) : {};
  return { ...local, ...process.env };
}
