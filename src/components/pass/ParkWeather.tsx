import "server-only";
import { getParkWeather } from "@/lib/weather/park-weather";
import { WeatherCard } from "./WeatherCard";

const nowMs = () => Date.now();

/**
 * The live weather card for a pass page. Rendered inside <Suspense> (src/app/pass/[id]/page.tsx), so the pass shows
 * at once and the card streams in; the lookup gives up after its 8 s budget and then says why there is no forecast.
 */
export async function ParkWeather({ park }: { park: { name: string; lat: number; lng: number } }) {
  const view = await getParkWeather(park, nowMs());
  return <WeatherCard view={view} />;
}
