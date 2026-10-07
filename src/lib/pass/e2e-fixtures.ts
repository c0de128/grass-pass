/**
 * Round 8 (Q-8-01): the print tests need the LONGEST real sheets, and those are real passes that live in tests/fixtures
 * (recorded, never edited), not in any store. With GP_E2E_FIXTURE_PASSES=1, and only then, the pass page and its print
 * page also open these recorded passes by their id, so Playwright can print them on the real print route, keyless.
 *
 * Off unless that exact variable is "1" (never set in production; playwright.config.ts sets it for the server it
 * starts). The file list is fixed here: no part of a request ever becomes a path, and a file that is not a valid pass
 * is skipped.
 */
import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PassSchema, type Pass } from "./schema";

/** The recorded passes the print tests open (tests/fixtures; each file says where it came from in `_recording`). */
export const E2E_FIXTURE_FILES = [
  "pass-arbor-hills-13plus-full-live.json",
  "pass-celebration-13plus-live.json",
  "pass-oak-point-13plus-live.json",
  "pass-white-rock-13plus-live.json",
  "pass-arbor-hills-lucky-live.json",
  // Round 8: a 13+ pass made by the round-8 code (pass-arbor-hills-13plus-r8-live.json shares its id with the first file).
  "pass-white-rock-13plus-r8-live.json",
] as const;

export const E2E_FIXTURE_ENV = "GP_E2E_FIXTURE_PASSES";

let cache: ReadonlyMap<string, Pass> | null = null;

function load(): ReadonlyMap<string, Pass> {
  const out = new Map<string, Pass>();
  for (const f of E2E_FIXTURE_FILES) {
    try {
      const raw = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", f), "utf8")) as { pass?: unknown };
      const p = PassSchema.safeParse(raw.pass);
      if (p.success) out.set(p.data.id, p.data);
    } catch {
      // Missing or unreadable (a deploy without the tests folder): that file is simply not served.
    }
  }
  return out;
}

/** A recorded test pass by id, only when GP_E2E_FIXTURE_PASSES=1; null otherwise. */
export function e2eFixturePass(id: string, env: Record<string, string | undefined> = process.env): Pass | null {
  // Belt and braces: never on a Vercel production deployment, whatever the env says.
  if (env[E2E_FIXTURE_ENV] !== "1" || env.VERCEL_ENV === "production") return null;
  return (cache ??= load()).get(id) ?? null;
}
