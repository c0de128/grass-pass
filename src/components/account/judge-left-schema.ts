/** The GET /api/judge-passes answer (loaded on demand by the sign-in card, so zod stays out of the first JavaScript, UX-4-02). */
import { z } from "@/lib/zod-config";

export const LeftSchema = z.object({
  cap: z.number().int().nonnegative(),
  perConnection: z.number().int().nonnegative(),
  left: z.number().int().nonnegative(),
  leftForYou: z.number().int().nonnegative(),
});

/** The GET /api/passes-left answer (src/lib/accounts/pass-limits.ts), loaded on demand like LeftSchema. */
export const PassesLeftSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("free"), free: z.number().int().nonnegative(), left: z.number().int().nonnegative(), perDay: z.number().int().positive() }),
  z.object({ kind: z.literal("account"), perDay: z.number().int().positive(), left: z.number().int().nonnegative() }),
  LeftSchema.extend({ kind: z.literal("judge") }),
]);
