import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { FocusPassHeading } from "@/components/pass/FocusPassHeading";
import { DifferentPassButton } from "@/components/pass/DifferentPassButton";
import { PassPreview } from "@/components/pass/PassPreview";
import { ParkWeather, quickWeather, startParkWeather } from "@/components/pass/ParkWeather";
import { WeatherCard, WeatherCardLoading } from "@/components/pass/WeatherCard";
import { TripTips } from "@/components/pass/TripTips";
import { buttonClassName } from "@/components/ui/Button";
import { safeParkName } from "@/lib/ai/validate";
import { ADULT_PRINT_LINE } from "@/lib/pass/audience";
import { passPagePrintLine } from "@/lib/pass/print-size";
import { loadPass } from "@/lib/pass/make";
import { withClearMap } from "@/lib/spot/redraw";
import { passAsOf } from "@/lib/pass/as-of";
import { signInOptions } from "@/lib/accounts/config";
import { passItemStats } from "@/lib/reports/stats";
import { currentFreePassesLeft, currentSession } from "@/lib/accounts/current";
import { PassFeedback } from "@/components/pass/PassFeedback";
import { localDay } from "@/lib/time";

/**
 * A saved pass, read from the pass cache only (never calls OpenStreetMap, iNaturalist or the model).
 * One store read per request: metadata and page share it (SEC-1-02). SEC-2-01: an id that can't exist
 * (bad park id shape, a day outside the 30-day pass TTL, a variant above 3) is a 404 with no store read,
 * and repeat reads are memoized in process (src/lib/limits/pass-read.ts).
 * Accounts: for a signed-in grown-up the report buttons show, with the item report counts (one more read
 * per park per 5 min per instance, src/lib/reports/stats.ts; the proxy charges it as COSTS.passStats).
 */
// loadPass turns away ids that cannot exist (no store read) and opens pinned example passes (src/lib/pinned.ts).
// withClearMap: an older pass's Find This Spot map is redrawn framed on START and the X when the exact OSM answer it was
// drawn from is saved in the repo (src/lib/spot/redraw.ts; no extra store read, the stored pass is unchanged).
const getPass = cache(async (id: string) => {
  const pass = await loadPass(id);
  // Judge R9: a Lucky Finds reason in the present tense ("this server", "today") is said as of the pass's own day.
  return pass ? passAsOf(withClearMap(pass), today()) : null;
});

/** Today in Chicago (the pass day and the 3-a-day limit use it). */
function today(): string {
  return localDay(Date.now());
}

export async function generateMetadata(props: PageProps<"/pass/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const pass = await getPass(id);
  return {
    title: pass ? `Grass Pass for ${safeParkName(pass.park.name).name}` : "Grass Pass: pass not found",
    robots: { index: false, follow: false },
  };
}

export default async function PassPage(props: PageProps<"/pass/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const pass = await getPass(id);
  // Unknown or expired id: HTTP 404 with the honest "No pass here" copy (./not-found.tsx).
  if (!pass) notFound();
  const session = await currentSession();
  const signedIn = session !== null;
  // Kevin 2026-10-08: signed out, the free passes left today ("Make a different pass" may use one); cookie only.
  const freeLeft = signedIn ? 0 : await currentFreePassesLeft();
  // Report counts are shown to signed-in grown-ups (the ones who report); 1 read per park per 5 min.
  const stats = signedIn ? await passItemStats(pass) : {};
  const parkName = safeParkName(pass.park.name).name;
  // UX-10-01: the forecast is usually cached, so wait a moment for it and put the card in the first HTML (no layout
  // shift); only a slow lookup streams in behind a loading card of the same size.
  const weather = startParkWeather({ name: parkName, lat: pass.park.lat, lng: pass.park.lng });
  const weatherNow = await quickWeather(weather);

  return (
    <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-10 focus:outline-none sm:py-14">
      {/* Print first: on a phone the pass is long, and printing is the point (R1 judge/UX). */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Opens the one-page print layout, which opens the print dialog once (ADR 0004). */}
        <Link href={`/pass/${pass.id}/print?print=1`} prefetch={false} className={buttonClassName("primary")}>
          Print pass
        </Link>
        <p className="text-base text-muted-foreground">
          {/* Review MAJOR-3: a pass estimated to need 2 printed pages doesn't promise one (src/lib/pass/print-size.ts). */}
          {passPagePrintLine(pass, ADULT_PRINT_LINE)}
        </p>
      </div>
      <FocusPassHeading />
      {/* Weather for the park (Kevin, Oct 8): screen only, streamed in so the pass never waits for it; real Open-Meteo
          forecast + weather.gov alerts, or the honest "No weather data available" line (src/lib/weather). */}
      {weatherNow ? (
        <WeatherCard view={weatherNow} />
      ) : (
        <Suspense fallback={<WeatherCardLoading parkName={parkName} />}>
          <ParkWeather view={weather} />
        </Suspense>
      )}
      {/* Trip tips (Kevin, Oct 8): made once with the pass from that day's forecast, the park map and the sightings
          (src/lib/tips); screen only. An older pass says it was made before trip tips existed. */}
      <TripTips tips={pass.tripTips} today={today()} />
      <PassPreview pass={pass} reused={sp.reused === "1"} reports={{ signedIn, stats }} />
      <div className="flex flex-col gap-4">
        <DifferentPassButton
          parkId={pass.park.id}
          ageBand={pass.ageBand}
          variant={pass.variant}
          madeToday={pass.day === today()}
          example={sp.example === "1"}
          account={{ signedIn, options: signInOptions(), freeLeft }}
          returnTo={`/pass/${pass.id}`}
        />
        {/* Kevin 2026-10-08: signed-in grown-ups rate the pass (stars + tags, no text); signed out: a sign-in link. */}
        <PassFeedback passId={pass.id} signedIn={signedIn} judge={session?.p === "judge"} />
        <Link href="/" prefetch={false} className={buttonClassName("secondary", "self-start")}>
          Pick another park
        </Link>
      </div>
    </main>
  );
}
