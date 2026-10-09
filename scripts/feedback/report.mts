/**
 * Kevin's private pass-feedback report (Kevin, 2026-10-08): reads the shared Upstash store and prints the rating counts
 * per park and per tag. There is no public page for this.
 *
 *   pnpm feedback:report
 *
 * Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN from the shell or .env.local (never printed). Read-only:
 * one SCAN pass over `fb:{*}:h`, 1 HGETALL per park and 1 GET per park for its name (from a saved pass, when one is
 * still kept). Without Upstash it says "No data available" and why; it never prints made-up numbers.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { UpstashStore, upstashConfig } from "@/lib/cache/store";
import { feedbackFromHash, feedbackKeys, feedbackReport } from "@/lib/feedback";
import { formatFeedbackReport, NO_STORE_REPORT } from "@/lib/feedback/report";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** process.env over .env.local (process.env wins); KEY=VALUE lines only. */
function env(): Record<string, string | undefined> {
  const file = path.join(ROOT, ".env.local");
  const local: Record<string, string> = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      local[m[1]] = v;
    }
  }
  return { ...local, ...process.env };
}

test("pass feedback report (pnpm feedback:report)", async () => {
  const when = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });
  const cfg = upstashConfig(env());
  if (!cfg || !cfg.ok) {
    console.log(cfg && !cfg.ok ? `${NO_STORE_REPORT} (${cfg.reason})` : NO_STORE_REPORT);
    return;
  }
  const store = new UpstashStore({ url: cfg.url, token: cfg.token });
  const now = Date.now();
  const parks = await feedbackReport(store, now);
  const named = [];
  for (const p of parks) {
    // The newest rated pass of the park, if it is still saved (30 days), gives the park's name.
    const entries = feedbackFromHash(await store.hashGetAll(feedbackKeys(p.parkId).hash), now).sort((a, b) => b.day - a.day);
    let name: string | null = null;
    for (const e of entries.slice(0, 1)) {
      try {
        const raw = await store.get(`c:pass:${e.passId}`);
        const v = raw ? (JSON.parse(raw) as { v?: { park?: { name?: unknown } } }).v?.park?.name : null;
        if (typeof v === "string" && v.length <= 120) name = v;
      } catch {
        name = null;
      }
    }
    named.push({ ...p, name });
  }
  console.log(formatFeedbackReport(named, when));
});
