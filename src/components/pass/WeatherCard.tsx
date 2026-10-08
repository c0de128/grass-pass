import { CircleAlert, CloudOff, Droplets, Info, OctagonAlert, Smile, Sun, Sunset, Thermometer, TriangleAlert, Wind, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Mood } from "@/lib/weather/types";
import type { WeatherView } from "@/lib/weather/view";
import { WeatherArt, WeatherHills } from "./WeatherArt";

/**
 * The weather card at the top of a pass (screen only: hidden when printing; the printed sheet is unchanged).
 * Renders a WeatherView (src/lib/weather/view.ts) and nothing else: every word and number comes from a real
 * Open-Meteo forecast and weather.gov alerts, or the honest "No weather data available" line.
 *
 * Accessibility: a labelled region (no live region: it never re-reads). The mood is a visible word ("Stay safe",
 * "Weather warning", ...) and is in the region's name, so it never depends on colour or on the picture (aria-hidden).
 */

export const MOOD_BADGE: Record<Mood, string> = {
  great: "Perfect day",
  good: "Good day",
  caution: "Heads up",
  warning: "Weather warning",
  danger: "Stay safe",
};

const MOOD_ICON: Record<Mood, LucideIcon> = { great: Sun, good: Smile, caution: Info, warning: CircleAlert, danger: OctagonAlert };

export const OPEN_METEO_URL = "https://open-meteo.com/";
export const ATTRIBUTION = "Weather data by Open-Meteo.com";

const link = "font-semibold underline underline-offset-2";

function Chip({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5 rounded-full bg-(--wx-chip) px-3 py-1.5 text-sm ring-1 ring-(--wx-chip-ring)">
      {icon}
      <span className="font-semibold">{label}</span>
      <span>{children}</span>
    </li>
  );
}

const iconCls = "size-4 shrink-0 text-(--wx-muted)";

function Alerts({ view }: { view: WeatherView }) {
  if (view.alerts.length === 0) {
    return view.alertsNote ? (
      <p className="text-sm text-(--wx-muted)" data-testid="weather-alerts-note">
        {view.alertsNote}
      </p>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-(--wx-chip) p-3 ring-1 ring-(--wx-chip-ring) sm:p-4" data-testid="weather-alerts">
      <p className="text-xs font-bold tracking-widest uppercase">Official alerts</p>
      <ul className="flex flex-col gap-2">
        {view.alerts.map((a) => (
          <li key={a.line} className="flex items-start gap-2">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-(--wx-alert-text)" />
            <span>
              <strong className="font-bold">{a.line}</strong>
              <span className="block text-sm text-(--wx-muted)">From {a.sender}</span>
            </span>
          </li>
        ))}
      </ul>
      {view.alertsLink ? (
        <p className="text-sm">
          <a className={link} href={view.alertsLink}>
            Read the full alert on weather.gov
          </a>
        </p>
      ) : null}
    </div>
  );
}

export function WeatherCard({ view }: { view: WeatherView }) {
  if (view.kind === "none") {
    return (
      <section
        aria-label={`Weather at ${view.parkName}`}
        data-testid="weather-card"
        data-state="none"
        data-look="none"
        className="gp-wx relative flex flex-col gap-4 overflow-hidden rounded-3xl p-5 pb-14 ring-1 ring-border sm:p-7 sm:pb-16 print:hidden"
      >
        <div className="flex items-center gap-4">
          <WeatherArt look="none" className="size-16 shrink-0 sm:size-20" />
          <div className="flex flex-col gap-1">
            <p className="flex items-center gap-2 text-xs font-bold tracking-widest uppercase">
              <CloudOff aria-hidden="true" className="size-4" />
              Weather at {view.parkName}
            </p>
            <p className="text-base font-semibold sm:text-lg" data-testid="weather-headline">
              {view.reason}
            </p>
          </div>
        </div>
        <Alerts view={view} />
        <p className="text-xs text-(--wx-muted)">
          We ask{" "}
          <a className={link} href={OPEN_METEO_URL}>
            Open-Meteo.com
          </a>{" "}
          for the forecast. We never guess one.
        </p>
        <WeatherHills className="pointer-events-none absolute inset-x-0 bottom-0 h-10 w-full sm:h-12" />
      </section>
    );
  }

  const day = view.which === "today" ? "Today" : "Tomorrow";
  const warn = view.mood === "danger" || view.mood === "warning";
  const MoodIcon = MOOD_ICON[view.mood];
  return (
    <section
      aria-label={`${warn ? `${MOOD_BADGE[view.mood]}: weather` : "Weather"} at ${view.parkName}, ${day.toLowerCase()}`}
      data-testid="weather-card"
      data-state="forecast"
      data-look={view.look}
      data-mood={view.mood}
      className="gp-wx relative flex flex-col gap-4 overflow-hidden rounded-3xl p-5 pb-14 ring-1 ring-border sm:gap-5 sm:p-7 sm:pb-16 print:hidden"
    >
      <div className="flex items-center gap-3 sm:gap-6">
        <WeatherArt look={view.look} className="size-24 shrink-0 sm:size-32" />
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-xs font-bold tracking-widest uppercase">
            {day} at {view.parkName}
          </p>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <p className="font-heading text-5xl leading-none font-extrabold tracking-tight sm:text-6xl">
              {view.highF}°<span className="sr-only"> F high</span>
            </p>
            <p className="flex flex-col pb-1 text-sm leading-tight text-(--wx-muted)" aria-hidden="true">
              <span>high</span>
              <span>{view.dateLabel}</span>
            </p>
            <p className="gp-wx-badge mb-1 flex items-center gap-1.5 rounded-full py-1 pr-3 pl-2 text-xs font-bold tracking-wide uppercase" data-testid="weather-mood">
              <MoodIcon aria-hidden="true" className="size-4" strokeWidth={2.5} />
              {MOOD_BADGE[view.mood]}
            </p>
          </div>
        </div>
      </div>

      <p className="font-heading text-xl leading-snug font-bold text-balance sm:text-2xl" data-testid="weather-headline">
        {view.headline}
      </p>

      <ul aria-label="Forecast numbers" className="flex flex-wrap gap-2">
        <Chip icon={<Thermometer aria-hidden="true" className={iconCls} />} label="Low">
          {view.lowF}°
        </Chip>
        {view.rainPct !== null ? (
          <Chip icon={<Droplets aria-hidden="true" className={iconCls} />} label="Rain">
            {view.rainPct}%
          </Chip>
        ) : null}
        {view.wind ? (
          <Chip icon={<Wind aria-hidden="true" className={iconCls} />} label="Wind">
            {view.wind}
          </Chip>
        ) : null}
        {view.sunset ? (
          <Chip icon={<Sunset aria-hidden="true" className={iconCls} />} label="Sunset">
            {view.sunset}, back before dark
          </Chip>
        ) : null}
      </ul>

      {view.details.length + view.tips.length > 0 ? (
        <ul className="flex flex-col gap-1.5" data-testid="weather-tips">
          {[...view.details, ...view.tips].map((t) => (
            <li key={t} className="flex gap-2">
              <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-(--wx-dot)" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <Alerts view={view} />

      <p className="text-xs text-(--wx-muted)" data-testid="weather-meta">
        {view.which === "tomorrow" ? "It's evening at the park, so this is tomorrow's forecast. " : ""}
        Forecast updated {view.updated} ·{" "}
        <a className={link} href={OPEN_METEO_URL}>
          {ATTRIBUTION}
        </a>
        {view.alertsLink ? " · alerts from weather.gov" : ""}
      </p>
      <WeatherHills className="pointer-events-none absolute inset-x-0 bottom-0 h-10 w-full sm:h-12" />
    </section>
  );
}

/** While the forecast loads (streamed in; the pass never waits for it). Same footprint, no motion. */
export function WeatherCardLoading({ parkName }: { parkName: string }) {
  return (
    <section
      aria-label={`Weather at ${parkName}`}
      data-testid="weather-card"
      data-state="loading"
      data-look="cloudy"
      className="gp-wx flex min-h-36 items-center gap-4 rounded-3xl p-5 ring-1 ring-border sm:p-7 print:hidden"
    >
      <WeatherArt look="partly" className="size-16 shrink-0 opacity-60 sm:size-20" />
      <p className="text-base font-semibold">Checking the weather at {parkName}…</p>
    </section>
  );
}
