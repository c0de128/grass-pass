/**
 * Every outside service Grass Pass uses, for the /how-it-works blueprint and its services table (Kevin, 2026-10-09:
 * "a page that shows the services the app uses and how it implements AI"). One list, so the diagram and the table can
 * never disagree. Each entry names the code that uses it (`code`), checked by tests/unit/how-blueprint.test.tsx: the
 * file must exist and contain the host or package it names. Nothing here is a claim about quality or speed.
 */
import { oauthProviderNames, judgeDemoEnabled } from "@/lib/accounts/config";
import { SERPAPI_FREE_MONTHLY, limitsConfig } from "@/lib/limits/config";
import { DO_BASE_URL, configuredModelId, modelEndpoint } from "@/lib/model";
import { WILD_RADIUS_KM, WILD_WINDOW_DAYS } from "@/lib/sources/inat";

/** Where a service sits in the blueprint. */
export type ServiceGroup = "data" | "model" | "platform";

export type Service = {
  id: string;
  name: string;
  /** A short sub-name on the diagram (the APIs or the product used). */
  detail: string;
  group: ServiceGroup;
  /** What it is for, in a few plain words (the table and the diagram). */
  usedFor: string;
  /** Licence and/or cost, as far as the code, README or config say. */
  terms: string;
  url: string;
  /** The file that talks to it, and the host or package that file must contain (tests check both). */
  code: { file: string; contains: string };
};

/** The outside services, in the order data flows (data in, the model, then what runs the site). */
export function services(): Service[] {
  const providers = oauthProviderNames();
  const judge = judgeDemoEnabled();
  const signIn = [providers ? `${providers} sign-in` : null, judge ? `"Try as a judge"` : null].filter(Boolean).join(", ");
  const model = configuredModelId();
  // Where the model runs: DigitalOcean serverless inference unless MODEL_BASE_URL points elsewhere (src/lib/model.ts).
  const onDo = modelEndpoint().baseUrl === DO_BASE_URL;
  const host = onDo ? "inference.do-ai.run" : new URL(modelEndpoint().baseUrl).host;
  const cap = limitsConfig().aiDailyCap;
  return [
    {
      id: "osm",
      name: "OpenStreetMap",
      detail: "Nominatim search + Overpass map",
      group: "data",
      usedFor: "Park search, the park map, Find This Spot",
      terms: "ODbL 1.0, free",
      url: "https://www.openstreetmap.org/copyright",
      code: { file: "src/lib/sources/overpass.ts", contains: "overpass-api.de" },
    },
    {
      id: "inat",
      name: "iNaturalist",
      detail: `Sightings, ${WILD_RADIUS_KM} km, ${WILD_WINDOW_DAYS} days`,
      group: "data",
      usedFor: "Wildlife really seen nearby",
      terms: "Free API",
      url: "https://www.inaturalist.org/",
      code: { file: "src/lib/sources/inat.ts", contains: "api.inaturalist.org" },
    },
    {
      id: "wikipedia",
      name: "Wikipedia",
      detail: "Species summaries, via iNaturalist",
      group: "data",
      usedFor: "Species facts clues must quote",
      terms: "CC BY-SA",
      url: "https://www.wikipedia.org/",
      code: { file: "src/lib/sources/inat.ts", contains: "wikipedia_summary" },
    },
    {
      id: "serpapi",
      name: "SerpApi",
      detail: "Google Maps review counts",
      group: "data",
      usedFor: "Lucky Finds (counts, no review text)",
      terms: `Free plan (${SERPAPI_FREE_MONTHLY} a month)`,
      url: "https://serpapi.com/",
      code: { file: "src/lib/sources/serpapi.ts", contains: "serpapi.com/search.json" },
    },
    {
      id: "open-meteo",
      name: "Open-Meteo",
      detail: "Forecast",
      group: "data",
      usedFor: "Weather card, trip-tip facts",
      terms: "CC BY 4.0, free",
      url: "https://open-meteo.com/",
      code: { file: "src/lib/sources/open-meteo.ts", contains: "api.open-meteo.com" },
    },
    {
      id: "nws",
      name: "weather.gov",
      detail: "National Weather Service alerts",
      group: "data",
      usedFor: "Official US weather alerts",
      terms: "US public domain",
      url: "https://www.weather.gov/",
      code: { file: "src/lib/sources/nws-alerts.ts", contains: "api.weather.gov" },
    },
    {
      id: "gemma",
      name: model === "gemma-4-31B-it" ? "Gemma 4 31B" : model,
      detail: model === "gemma-4-31B-it" ? "gemma-4-31B-it on DigitalOcean" : `${model} (MODEL_ID)`,
      group: "model",
      usedFor: "Clues, riddle, trip tips",
      terms: model === "gemma-4-31B-it" ? "Apache-2.0 open weights" : "Set by MODEL_ID on this server",
      url: "https://huggingface.co/google/gemma-4-31B-it",
      code: { file: "src/lib/model.ts", contains: "inference.do-ai.run" },
    },
    {
      // Judge R11: DigitalOcean gets its own row (it was only inside the Gemma row). Facts: the endpoint and the
      // key-to-host rule are src/lib/model.ts (DO_BASE_URL, resolveModelTarget); per-token billing on prepaid credit is
      // README "Cost" and src/lib/limits/config.ts (aiDailyCap, AI_DAILY_CAP); the website itself is on Vercel (next row).
      id: "digitalocean",
      name: onDo ? "DigitalOcean" : host,
      detail: onDo ? "Serverless inference (the model)" : "Model server (MODEL_BASE_URL)",
      group: "platform",
      usedFor: onDo ? "Runs every Gemma call the site makes: no GPU of our own" : "Runs every model call on this server",
      terms: onDo ? `Per token, prepaid credit; at most ${cap} model calls a day` : "Set by MODEL_BASE_URL on this server",
      url: onDo ? "https://docs.digitalocean.com/products/gradient-ai-platform/how-to/use-serverless-inference/" : `https://${host}/`,
      code: { file: "src/lib/model.ts", contains: "inference.do-ai.run" },
    },
    {
      id: "vercel",
      name: "Vercel",
      detail: "Hosting + daily cron",
      group: "platform",
      usedFor: "Hosting, daily example warm-up",
      terms: "Hobby plan",
      url: "https://vercel.com/",
      code: { file: "vercel.json", contains: "/api/cron/warm-examples" },
    },
    {
      id: "upstash",
      name: "Upstash Redis",
      detail: "Cache, saved passes, limits",
      group: "platform",
      usedFor: "Saved passes, caches, limits",
      terms: "Free plan (500,000 commands a month)",
      url: "https://upstash.com/",
      code: { file: "src/lib/cache/store.ts", contains: "UPSTASH_REDIS_REST_URL" },
    },
    {
      id: "authjs",
      name: "Auth.js",
      detail: signIn || "Sign-in (not set up here)",
      group: "platform",
      usedFor: signIn ? `Grown-up sign-in: ${signIn}` : "Grown-up sign-in (none set up here)",
      terms: "ISC licence",
      url: "https://authjs.dev/",
      code: { file: "src/auth.ts", contains: "next-auth/providers/github" },
    },
  ];
}
