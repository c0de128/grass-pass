/**
 * GET /api/parks?q=<town, ZIP or park name>  |  ?lat=<2 decimals>&lng=<2 decimals>
 * Named OpenStreetMap parks within 5 km, nearest first (SPEC F1). Guards, limits, caches and
 * upstream politeness live in src/lib/parks/search.ts (a route file may only export handlers).
 */
import { WaiterAbortedError } from "@/lib/cache";
import { guardGet } from "@/lib/http/guard";
import { jsonError } from "@/lib/http/respond";
import { clientIp } from "@/lib/limits";
import { parseSearchParams, searchParks } from "@/lib/parks/search";

export const runtime = "nodejs";
/** Worst case: Nominatim queue (8 s) + answer (10 s) + Overpass total budget (50 s, all attempts) = 68 s. */
export const maxDuration = 90;

export async function GET(req: Request): Promise<Response> {
  const denied = guardGet(req);
  if (denied) return jsonError(denied.status, { code: denied.code, message: denied.message });

  const parsed = parseSearchParams(new URL(req.url).searchParams);
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
