/**
 * POST /api/parks  { "q": "<town, ZIP or park name>" }  |  { "lat": "<2 decimals>", "lng": "<2 decimals>" }
 * Named OpenStreetMap parks within 5 km, nearest first (SPEC F1). Guards, limits, caches and
 * upstream politeness live in src/lib/parks/search.ts (a route file may only export handlers).
 *
 * POST, not GET (SEC-1-03): what you typed and your rounded location stay out of the address, so
 * they are not in the hosting provider's request logs. Same guards as /api/pass: same origin (403),
 * JSON (415), 2 KB streamed body cap (413), zod (400).
 */
import "@/lib/zod-config";
import { z } from "zod";
import { WaiterAbortedError } from "@/lib/cache";
import { guardJsonPost } from "@/lib/http/guard";
import { jsonError } from "@/lib/http/respond";
import { clientIp } from "@/lib/limits";
import { PlaceQueryLimits } from "@/lib/parks/schema";
import { parseSearchParams, searchParks } from "@/lib/parks/search";

export const runtime = "nodejs";
/** Worst case: Nominatim queue (8 s) + answer (10 s) + Overpass total budget (50 s, all attempts) = 68 s. */
export const maxDuration = 90;

const BodySchema = z
  .object({
    // Longer text gets the friendly "too long" field error from parseSearchParams.
    q: z.string().max(PlaceQueryLimits.max * 4).optional(),
    lat: z.string().max(20).optional(),
    lng: z.string().max(20).optional(),
  })
  .strict();

export async function POST(req: Request): Promise<Response> {
  const g = await guardJsonPost(req, BodySchema);
  if (!g.ok) return jsonError(g.failure.status, { code: g.failure.code, message: g.failure.message });

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(g.data)) if (typeof v === "string") params.set(k, v);
  const parsed = parseSearchParams(params);
  if (!parsed.ok) {
    return Response.json(
      { error: { code: parsed.error.code, message: parsed.error.message, field: parsed.error.field } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const out = await searchParks(parsed.input, { ip: clientIp(req), signal: req.signal });
    if (!out.ok) return jsonError(out.status, out.error);
    return Response.json(out.result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof WaiterAbortedError) {
      // The browser left; nobody reads this. Started upstream calls still finish and are cached.
      return new Response(null, { status: 499 });
    }
    throw err;
  }
}
