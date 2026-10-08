import "server-only";
import { getParkWeather } from "@/lib/weather/park-weather";
import type { WeatherView } from "@/lib/weather/view";
import { WeatherCard } from "./WeatherCard";

const nowMs = () => Date.now();

/**
 * UX-10-01 (round 10): how long the pass page waits for the forecast before it streams the card in instead. The
 * forecast is cached for 30 minutes per park (and warmed when the pass is made), so most views have it in a few
 * milliseconds and the card is in the first HTML: nothing below it (the trip tips, the pass) moves when it arrives.
 */
export const WEATHER_INLINE_WAIT_MS = 1_200;

/** Start the park's forecast lookup (it gives up after its own 8 s budget and then says why there is no forecast). */
export function startParkWeather(park: { name: string; lat: number; lng: number }): Promise<WeatherView> {
  return getParkWeather(park, nowMs());
}

/** The lookup's answer if it arrives within `ms`, else null (never rejects). */
export async function quickWeather(p: Promise<WeatherView>, ms = WEATHER_INLINE_WAIT_MS): Promise<WeatherView | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p.catch(() => null), new Promise<null>((r) => (timer = setTimeout(() => r(null), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The live weather card for a pass page when the forecast was not ready within WEATHER_INLINE_WAIT_MS: rendered inside
 * <Suspense> (src/app/pass/[id]/page.tsx), so the pass shows at once and the card streams in.
 */
export async function ParkWeather({ view }: { view: Promise<WeatherView> }) {
  return <WeatherCard view={await view} />;
}
