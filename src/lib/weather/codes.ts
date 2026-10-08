/**
 * WMO weather interpretation codes, as Open-Meteo documents them (https://open-meteo.com/en/docs, "WMO Weather
 * interpretation codes"): 0 clear, 1-3 mainly clear / partly cloudy / overcast, 45/48 fog, 51-57 drizzle,
 * 61-67 rain, 71-77 snow, 80-82 rain showers, 85-86 snow showers, 95 thunderstorm, 96/99 thunderstorm with hail.
 * The words are ours, written for parents and kids. An unknown code is "mixed weather" (never guessed as sunny).
 */

/** What the picture on the weather card shows. */
export type Sky = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm" | "unknown";

type CodeInfo = { sky: Sky; words: string };

const TABLE: Record<number, CodeInfo> = {
  0: { sky: "clear", words: "clear skies" },
  1: { sky: "clear", words: "mostly clear skies" },
  2: { sky: "partly", words: "a few clouds" },
  3: { sky: "cloudy", words: "cloudy skies" },
  45: { sky: "fog", words: "fog" },
  48: { sky: "fog", words: "icy fog" },
  51: { sky: "drizzle", words: "light drizzle" },
  53: { sky: "drizzle", words: "drizzle" },
  55: { sky: "drizzle", words: "heavy drizzle" },
  56: { sky: "drizzle", words: "freezing drizzle" },
  57: { sky: "drizzle", words: "freezing drizzle" },
  61: { sky: "rain", words: "light rain" },
  63: { sky: "rain", words: "rain" },
  65: { sky: "rain", words: "heavy rain" },
  66: { sky: "rain", words: "freezing rain" },
  67: { sky: "rain", words: "freezing rain" },
  71: { sky: "snow", words: "light snow" },
  73: { sky: "snow", words: "snow" },
  75: { sky: "snow", words: "heavy snow" },
  77: { sky: "snow", words: "snow grains" },
  80: { sky: "rain", words: "rain showers" },
  81: { sky: "rain", words: "rain showers" },
  82: { sky: "rain", words: "heavy rain showers" },
  85: { sky: "snow", words: "snow showers" },
  86: { sky: "snow", words: "heavy snow showers" },
  95: { sky: "storm", words: "thunderstorms" },
  96: { sky: "storm", words: "thunderstorms with hail" },
  99: { sky: "storm", words: "thunderstorms with hail" },
};

export function codeInfo(code: number | null | undefined): CodeInfo {
  if (code === null || code === undefined) return { sky: "unknown", words: "mixed weather" };
  return TABLE[code] ?? { sky: "unknown", words: "mixed weather" };
}

/** Thunderstorm codes (95, 96, 99). */
export const isStormCode = (code: number | null | undefined): boolean => code === 95 || code === 96 || code === 99;

/** Snow, freezing drizzle or freezing rain: slippery and cold. */
export const isWinterCode = (code: number | null | undefined): boolean =>
  code !== null && code !== undefined && ([56, 57, 66, 67, 71, 73, 75, 77, 85, 86] as number[]).includes(code);

/** Clear, mostly clear or partly cloudy (the only skies a "perfect" day may have). */
export const isFairCode = (code: number | null | undefined): boolean => code === 0 || code === 1 || code === 2;

export const isFogCode = (code: number | null | undefined): boolean => code === 45 || code === 48;
