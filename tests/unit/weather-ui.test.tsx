/**
 * The weather card (src/components/pass/WeatherCard.tsx), rendered from REAL recorded forecasts and alerts
 * (tests/fixtures/weather), its colours (contrast, light and dark), and where it is (and is not) on the site.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MOOD_BADGE, WeatherCard, WeatherCardLoading } from "@/components/pass/WeatherCard";
import { WEATHER_SOURCES } from "@/lib/about/content";
import { parseForecast } from "@/lib/sources/open-meteo";
import { parseAlerts } from "@/lib/sources/nws-alerts";
import { buildWeatherView, type WeatherView } from "@/lib/weather/view";

const DIR = new URL("../fixtures/weather/", import.meta.url);
const rec = (f: string) => JSON.parse(readFileSync(new URL(f, DIR), "utf8"));

function view(slug: string, us: boolean): WeatherView {
  const f = rec(`open-meteo-${slug}.json`);
  const t = Date.parse(f._recording.fetchedAt);
  const alerts = us ? parseAlerts(rec(`nws-alerts-${slug}.json`).body, t) : null;
  return buildWeatherView(f._recording.park, { fetchedAt: t, forecast: parseForecast(f.body), forecastError: null, alerts, alertsStatus: us ? "ok" : "not_us" }, t);
}
const html = (v: WeatherView) => renderToStaticMarkup(<WeatherCard view={v} />);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

describe("weather card markup", () => {
  it("a perfect day (Forest Park, St. Louis): headline, numbers, sunset, attribution link, no alerts", () => {
    const h = html(view("forest-park-st-louis-mo", true));
    const t = text(h);
    expect(t).toContain("Today at Forest Park");
    expect(t).toContain("The weather will be perfect today: clear skies, a high of 84° and no rain in sight.");
    expect(t).toContain("Perfect day");
    for (const s of ["Low 54°", "Rain 0%", "Wind 7 mph, gusts 13", "Sunset 6:32 PM, back before dark"]) expect(t).toContain(s);
    expect(t).toContain("Forecast updated 9:21 AM CDT");
    expect(h).toContain('href="https://open-meteo.com/"');
    expect(t).toContain("Weather data by Open-Meteo.com");
    expect(t).toContain("No official weather alerts here right now (weather.gov).");
  });

  it("an alert is listed with its real sender and a weather.gov link (Bayfront Park, Miami)", () => {
    const h = html(view("bayfront-park-miami-fl", true));
    const t = text(h);
    expect(t).toContain("Good hunting weather today: cloudy skies, a high of 86° and a 19% chance of rain.");
    expect(t).toContain("Coastal Flood Statement until 10 PM tomorrow");
    expect(t).toContain("From NWS Miami FL");
    expect(h).toContain('href="https://forecast.weather.gov/MapClick.php?lat=25.78&amp;lon=-80.19"');
  });

  it("is screen only, a labelled region, never a live region, with the picture hidden from screen readers", () => {
    for (const [slug, us] of [
      ["forest-park-st-louis-mo", true],
      ["parque-del-centenario-merida-mx", false],
      ["frank-brown-park-panama-city-beach-fl", true],
    ] as const) {
      const h = html(view(slug, us));
      expect(h).toMatch(/^<section aria-label="[^"]+"/);
      expect(h).toContain("print:hidden");
      expect(h).not.toMatch(/role="alert"|aria-live|role="status"/);
      for (const svg of h.match(/<svg[^>]*>/g) ?? []) expect(svg).toContain('aria-hidden="true"');
      // The temperature is said with its unit for screen readers.
      expect(h).toMatch(/°<span class="sr-only"> F high<\/span>/);
    }
  });

  it("danger and warning are in words and in the region's name (not colour alone)", () => {
    const storm = html(view("parque-del-centenario-merida-mx", false));
    expect(storm).toContain('aria-label="Stay safe: weather at Parque del Centenario, today"');
    expect(storm).toContain('data-mood="danger"');
    expect(text(storm)).toContain("Storms today from about 1 PM: save the hunt for another day.");
    expect(text(storm)).toContain("When thunder roars, go indoors.");
    const hot = html(view("papago-park-phoenix-az", true));
    expect(hot).toContain('aria-label="Weather warning: weather at Papago Park, today"');
    expect(text(hot)).toContain("No official weather alerts here right now (weather.gov).");
    const hurricane = text(html(view("frank-brown-park-panama-city-beach-fl", true)));
    expect(hurricane).toContain("Hurricane Warning: no end time given yet");
    expect(hurricane).toContain("Storm Surge Warning: no end time given yet");
    expect(hurricane).not.toContain("Flood Watch"); // at most 2 alerts
    expect(Object.values(MOOD_BADGE)).toEqual(["Perfect day", "Good day", "Heads up", "Weather warning", "Stay safe"]);
  });

  it("tomorrow is labelled as tomorrow, with the reason", () => {
    const t = text(html(view("rizal-park-manila", false)));
    expect(t).toContain("Tomorrow at Rizal Park");
    expect(t).toContain("It's evening at the park, so this is tomorrow's forecast.");
    expect(t).not.toContain("weather.gov");
  });

  it("no forecast: only the honest line, no numbers, no picture of sunshine", () => {
    const v = buildWeatherView({ name: "Celebration Park", lat: 33.10824, lng: -96.62468 }, { fetchedAt: 0, forecast: null, forecastError: "timeout", alerts: null, alertsStatus: "failed" }, Date.now());
    const h = html(v);
    const t = text(h);
    expect(t).toContain("No weather data available: the weather service didn't answer in time.");
    expect(t).toContain("Official alerts: we couldn't check weather.gov just now.");
    expect(t).toContain("We never guess one.");
    expect(t).not.toMatch(/°|%|Sunset/);
    expect(h).toContain('data-state="none"');
    expect(h).not.toContain("gp-wx-rays");
  });

  it("the loading state has no motion and names the park", () => {
    const h = renderToStaticMarkup(<WeatherCardLoading parkName="Celebration Park" />);
    expect(text(h)).toBe("Checking the weather at Celebration Park…");
    expect(h).toContain('data-state="loading"');
    expect(h).toContain("print:hidden");
  });
});

// ---------- colours: every text pair >= 4.5:1 in light and dark (WCAG 2.2 AA) ----------

const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {\n  --wx-sunny-top`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--wx-([a-z-]+):\s*(#[0-9a-fA-F]{6}|rgb\([^)]+\))/g)) out[m[1]] = m[2];
  return out;
}

type RGB = [number, number, number];
function rgb(c: string): { rgb: RGB; a: number } {
  if (c.startsWith("#")) {
    const n = parseInt(c.slice(1), 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: 1 };
  }
  const m = /rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(c);
  if (!m) throw new Error(c);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4]) };
}
const over = (top: string, under: RGB): RGB => {
  const { rgb: c, a } = rgb(top);
  return [0, 1, 2].map((i) => c[i] * a + under[i] * (1 - a)) as RGB;
};
function lum([r, g, b]: RGB): number {
  const ch = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const ratio = (a: RGB, b: RGB) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

describe.each([
  ["light", ":root"],
  ["dark", ':root[data-theme="dark"]'],
])("weather card colours, %s", (_name, sel) => {
  const p = block(sel);
  const looks = ["sunny", "cloudy", "rain", "hot", "cold", "storm"];

  it("text and muted text on both ends of every sky, and on the chips over them", () => {
    for (const look of looks) {
      for (const end of ["top", "bottom"]) {
        const bg = rgb(p[`${look}-${end}`]).rgb;
        const chip = over(p["chip-bg"], bg);
        for (const [name, fg] of [
          ["text", p.text],
          ["muted", p["text-muted"]],
        ]) {
          expect(ratio(rgb(fg).rgb, bg), `${name} on ${look}-${end}`).toBeGreaterThanOrEqual(4.5);
          expect(ratio(rgb(fg).rgb, chip), `${name} on a chip over ${look}-${end}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("every mood badge, and the warning icon against the skies it sits on (>= 3:1 for graphics)", () => {
    for (const mood of ["great", "good", "caution", "warning", "danger"]) {
      expect(ratio(rgb(p[`badge-${mood}-text`]).rgb, rgb(p[`badge-${mood}`]).rgb), mood).toBeGreaterThanOrEqual(4.5);
    }
    for (const look of looks) {
      const chip = over(p["chip-bg"], rgb(p[`${look}-top`]).rgb);
      expect(ratio(rgb(p["alert-icon"]).rgb, chip), `alert icon on ${look}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("the dark palette is the same in both dark selectors (system dark and the toggle)", () => {
    if (sel === ":root") return;
    const sys = css.slice(css.indexOf(':root:not([data-theme="light"]) {\n    --wx-sunny-top'));
    const body = sys.slice(0, sys.indexOf("}"));
    const fromMedia: Record<string, string> = {};
    for (const m of body.matchAll(/--wx-([a-z-]+):\s*(#[0-9a-fA-F]{6}|rgb\([^)]+\))/g)) fromMedia[m[1]] = m[2];
    expect(fromMedia).toEqual(p);
  });
});

describe("where the card lives", () => {
  const page = readFileSync(new URL("../../src/app/pass/[id]/page.tsx", import.meta.url), "utf8");
  const print = readFileSync(new URL("../../src/app/pass/[id]/print/page.tsx", import.meta.url), "utf8");

  it("on the pass page, in the first HTML when the forecast is ready within a moment, else streamed in a Suspense boundary, above the pass card", () => {
    // UX-10-01 (round 10): the inline card means no layout shift for the trip tips and the pass below it.
    expect(page).toMatch(/const weatherNow = await quickWeather\(weather\);/);
    expect(page).toMatch(/\{weatherNow \? \(\s*<WeatherCard view=\{weatherNow\} \/>/);
    expect(page).toMatch(/<Suspense fallback=\{<WeatherCardLoading parkName=\{parkName\} \/>\}>\s*<ParkWeather /);
    expect(page.indexOf("<ParkWeather")).toBeLessThan(page.indexOf("<PassPreview"));
  });

  it("never on the print page", () => {
    expect(print).not.toMatch(/Weather/);
  });

  it("credited on /about with its licence (the four pass data sources stay four)", () => {
    expect(WEATHER_SOURCES.map((s) => `${s.name} (${s.licence})`)).toEqual(["Open-Meteo (CC BY 4.0)", "National Weather Service (US public domain)"]);
    const about = readFileSync(new URL("../../src/app/about/page.tsx", import.meta.url), "utf8");
    expect(about).toContain("WEATHER_SOURCES.map");
    expect(about).toContain("Weather data by Open-Meteo.com");
  });
});
