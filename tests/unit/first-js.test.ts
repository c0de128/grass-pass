/**
 * UX-4-02 (audit R4): the home page's first JavaScript carries no zod. The client keeps validating every answer:
 * the header's session check uses a small hand-written parser (same rules as the zod schema it replaced), and the
 * search / pass answers are checked with the real zod schemas, loaded on demand with the request.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMe } from "@/components/account/session-schema";
import { z } from "@/lib/zod-config";
import * as passConstants from "@/lib/pass/constants";
import * as passSchema from "@/lib/pass/schema";
import * as parksConstants from "@/lib/parks/constants";
import * as parksSchema from "@/lib/parks/schema";

// The zod schema the header used before (R3's /api/me reader), kept here as the reference the hand-written check
// must agree with.
const Reference = z.discriminatedUnion("signedIn", [
  z.object({ signedIn: z.literal(false) }),
  z.object({ signedIn: z.literal(true), provider: z.enum(["github", "google", "judge"]), name: z.string().max(40).nullable() }),
]);

describe("parseMe agrees with the zod schema it replaced", () => {
  const cases: unknown[] = [
    // The shapes GET /api/me really sends (src/lib/accounts/endpoints.ts meResponse).
    { signedIn: false },
    { signedIn: true, provider: "judge", name: null },
    { signedIn: true, provider: "github", name: "Kevin" },
    { signedIn: true, provider: "google", name: null },
    // Wrong shapes.
    { signedIn: true, provider: "github", name: "x".repeat(41) },
    { signedIn: true, provider: "github", name: 42 },
    { signedIn: true, provider: "github" },
    { signedIn: true, provider: "facebook", name: null },
    { signedIn: true, name: null },
    { signedIn: "yes" },
    {},
    null,
    [],
    "signed in",
    42,
    undefined,
  ];
  it.each(cases.map((c) => [JSON.stringify(c) ?? "undefined", c]))("%s", (_label, c) => {
    const ref = Reference.safeParse(c);
    const mine = parseMe(c);
    expect(mine.success).toBe(ref.success);
    if (mine.success && ref.success) expect(mine.data).toEqual(ref.data);
  });
});

describe("zod-free constants match what the schemas export", () => {
  it("pass constants", () => {
    for (const k of Object.keys(passConstants)) expect((passSchema as Record<string, unknown>)[k], k).toBe((passConstants as Record<string, unknown>)[k]);
    for (const b of passConstants.AGE_BANDS) expect(passSchema.AgeBandSchema.safeParse(b).success).toBe(true);
    for (const v of ["6-10", "4-6", "10-13", "3-5", "", null, 6]) expect(passConstants.isAgeBand(v)).toBe(passSchema.AgeBandSchema.safeParse(v).success);
  });
  it("parks constants", () => {
    for (const k of Object.keys(parksConstants)) expect((parksSchema as Record<string, unknown>)[k], k).toBe((parksConstants as Record<string, unknown>)[k]);
  });
});

describe("the home page's client components import no zod at the top level", () => {
  const files = [
    "src/components/account/AccountMenu.tsx",
    "src/components/account/session-schema.ts",
    "src/components/account/SignInCard.tsx",
    "src/components/parks/FindAPark.tsx",
    "src/components/pass/PassMaker.tsx",
    "src/components/pass/usePassRequest.ts",
    "src/components/pass/PassStatus.tsx",
    "src/components/ThemeToggle.tsx",
    "src/lib/pass/constants.ts",
    "src/lib/parks/constants.ts",
  ];
  it.each(files)("%s", (f) => {
    const src = readFileSync(f, "utf8");
    // Static (non-type) imports of zod or of the zod schema modules; `import type` and `import()` are fine.
    const statics = [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(statics.filter((p) => /^zod$|zod-config$|\/lib\/(pass|parks)\/schema$/.test(p))).toEqual([]);
  });
});
