/**
 * The GET /api/me answer as the header reads it. A small hand-written check instead of zod, so the header (on
 * every page) does not pull the zod chunk into the first JavaScript (audit R4 UX-4-02). Same rules as the zod
 * schema it replaces (tests/unit/first-js.test.ts compares them): `{ signedIn: false }`, or
 * `{ signedIn: true, provider: "github" | "google" | "judge", name: string (up to 40) | null }`.
 */
export type Me = { signedIn: false } | { signedIn: true; provider: "github" | "google" | "judge"; name: string | null };

const PROVIDERS = new Set(["github", "google", "judge"]);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseMe(v: unknown): { success: true; data: Me } | { success: false } {
  if (!isObject(v)) return { success: false };
  if (v.signedIn === false) return { success: true, data: { signedIn: false } };
  if (v.signedIn !== true) return { success: false };
  if (typeof v.provider !== "string" || !PROVIDERS.has(v.provider)) return { success: false };
  const name = v.name;
  if (name !== null && (typeof name !== "string" || name.length > 40)) return { success: false };
  return { success: true, data: { signedIn: true, provider: v.provider as "github" | "google" | "judge", name } };
}
