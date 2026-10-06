import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PassPreview } from "@/components/pass/PassPreview";
import { ParkDataList, ProgressSteps, SectionNotes } from "@/components/pass/PassStatus";
import { resetStores } from "@/lib/cache/store";
import { setLogSink } from "@/lib/log";
import { formatDay, formatTime, modelLicence } from "@/lib/pass/format";
import { makePass, resetPassMaking } from "@/lib/pass/make";
import type { Pass } from "@/lib/pass/schema";
import { PASS_COPY } from "@/lib/pass/schema";
import { SAFETY_FOOTNOTE } from "@/lib/safety/danger-taxa";
import { PARKS, passReplay } from "./support/pass-replay";

/** Real passes made by the app code from the live recordings. */
async function realPass(parkId: string): Promise<Pass> {
  const r = passReplay();
  const out = await makePass(
    { parkId, ageBand: "6-10" },
    { ip: "192.0.2.9", fetchImpl: r.fetchImpl, modelFetch: r.fetchImpl, env: { DO_INFERENCE_API_KEY: "test-key-not-real" } },
  );
  if (out.kind !== "pass") throw new Error(out.kind);
  return out.pass;
}

let restore: () => void;
beforeEach(() => {
  resetStores();
  resetPassMaking();
  restore = setLogSink(() => undefined);
});
afterEach(() => {
  restore();
  vi.unstubAllGlobals();
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("PassPreview (screen pass)", () => {
  it("Celebration: 8 park finds with evidence, the exact empty Wild Finds copy, Lucky Finds off, model + times", async () => {
    const pass = await realPass(PARKS.celebration.id);
    const html = renderToStaticMarkup(<PassPreview pass={pass} />);
    const t = text(html);
    expect(html).toContain('<h1 id="pass-title"');
    expect(t).toContain("Celebration Park");
    expect(t).toContain("No data available: no research-grade sightings within 1.5 km in the last 14 days on iNaturalist.");
    expect(t).toContain(PASS_COPY.luckyOff);
    expect((t.match(/on the park map · OpenStreetMap/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(t).toContain(`Made ${formatTime(pass.generatedAt)} by gemma-4-31B-it (open model, Apache-2.0)`);
    expect(t).not.toContain("reused for this park today");
    expect(html).toContain("<details>"); // answer key is folded away from kids
    expect(t).toContain("© OpenStreetMap contributors");
    expect(t).toContain("Wildlife sightings checked");
    expect(t).not.toContain(SAFETY_FOOTNOTE); // nothing was filtered at Celebration
  });

  it("Connemara: wild finds carry safety lines; the safety footnote shows; a reused pass says so", async () => {
    const pass = await realPass(PARKS.connemara.id);
    const t = text(renderToStaticMarkup(<PassPreview pass={pass} reused />));
    expect(t).toContain("seen 2 times since");
    expect(t).toContain("Look, don't touch. It has sharp spines or thorns.");
    expect(t).toContain(SAFETY_FOOTNOTE);
    expect(t).toContain("(reused for this park today)");
    expect(t).toContain("Golden-eye Lichen (Teloschistes chrysophthalmus)"); // in the answer key
  });

  it("missing finds are stated honestly, never padded", async () => {
    const pass = await realPass(PARKS.celebration.id);
    const short: Pass = { ...pass, items: pass.items.slice(0, 5), removed: { notGrounded: 2, other: 1 } };
    const t = text(renderToStaticMarkup(<PassPreview pass={short} />));
    expect(t).toContain("No data available for 3 more finds");
    expect(t).toContain("2 clues were removed because they didn't match their source.");
    expect(t).toContain("1 clue was removed because it gave away the answer or broke one of our rules.");
  });
});

describe("status pieces", () => {
  it("progress is a polite live checklist", () => {
    const html = renderToStaticMarkup(
      <ProgressSteps
        steps={[
          { step: "map", text: "Reading the park map (OpenStreetMap)…" },
          { step: "clues", text: "Writing clues with gemma-4-31B-it (open model)…" },
        ]}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(text(html)).toContain("✓ Reading the park map (OpenStreetMap)… Done.");
  });

  it("section notes and park data (model failure) show real data only", () => {
    const t = text(
      renderToStaticMarkup(
        <>
          <SectionNotes sections={{ park: { status: "ok" }, wild: { status: "unavailable", message: "No data available: iNaturalist didn't answer." }, lucky: { status: "off", message: PASS_COPY.luckyOff } }} />
          <ParkDataList data={{ parkName: "X Park", items: [{ section: "park", answer: "Bench", evidence: "1 on the park map · OpenStreetMap" }] }} />
        </>,
      ),
    );
    expect(t).toContain("No data available: iNaturalist didn't answer.");
    expect(t).toContain("isn't a pass");
    expect(t).toContain("Bench (1 on the park map · OpenStreetMap)");
  });

  it("formatting: Chicago time with zone, day names, licences from the answering model id", () => {
    expect(formatTime("2026-10-05T23:19:34.106Z")).toBe("Oct 5, 6:19 PM CDT");
    expect(formatDay("2026-10-10")).toBe("Saturday, Oct 10");
    expect(modelLicence("gemma-4-31B-it")).toBe("Apache-2.0");
    expect(modelLicence("llama-4-maverick")).toBe("Llama 4 Community Licence");
    expect(modelLicence("mystery-model")).toBeNull();
  });
});
