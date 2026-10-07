/**
 * The pass wizard (Kevin 2026-10-07): the modal that guides park -> explorer -> make it, and the making animation.
 * The dialog's runtime behaviour (focus moves in and back, Esc, inert page, no scroll behind) is checked in the
 * browser by tests/e2e/pass-wizard.spec.ts; here: the markup, the step order, the real-progress-only checklist,
 * the sign-in resume store, and that every animation sits behind prefers-reduced-motion.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { makeTitle, PassMaker, rememberForSignIn, RESUME_KEY, takeResume } from "@/components/pass/PassMaker";
import { checklistRows, MakingChecklist, MakingScene, MAKING_PLAN, sceneStage } from "@/components/pass/PassMaking";
import { stepAnnouncement, StepTrail, WIZARD_STEPS } from "@/components/pass/WizardParts";
import type { Park } from "@/lib/parks/schema";
import type { PassStep } from "@/lib/pass/schema";
import { stepText } from "@/lib/ai/build-pass";

// The server's own step texts (src/lib/ai/build-pass.ts), with the model id the recorded passes were written by.
const env = { DO_INFERENCE_API_KEY: "", MODEL_API_KEY: "" } as unknown as NodeJS.ProcessEnv;
const real = (step: PassStep) => ({ step, text: stepText(step, env) });

const account = { signedIn: false, options: { providers: ["github" as const], judge: true, configured: true } };

describe("the hero card and the dialog markup", () => {
  const html = renderToStaticMarkup(<PassMaker account={account} />);

  it("the hero card is just the search: the place field, Find parks, Use my location (the age moved into the wizard)", () => {
    expect(html).toContain('aria-label="Find a park"');
    expect(html).toContain("Town, ZIP or park name");
    expect(html).toContain('placeholder="Your town, ZIP or park name"');
    expect(html).toContain("Find parks");
    expect(html).toContain("Use my location");
    expect(html).not.toContain('type="radio"');
  });

  it("is a native dialog, closed on first paint, labelled by its step heading, with a named close button", () => {
    expect(html).toMatch(/<dialog[^>]*class="gp-wizard"/);
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
    const labelledby = /<dialog[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledby).toBeTruthy();
    expect(html).toContain(`<h2 id="${labelledby}" tabindex="-1"`);
    expect(html).toContain('aria-label="Close"');
    // A polite region for "Step 2 of 3: Who's exploring?".
    expect(html).toMatch(/role="status" aria-live="polite"[^>]*data-testid="wizard-announce"/);
  });
});

describe("step order and words", () => {
  it("1 Park, 2 Explorer, 3 Make it; the age step reads for any age", () => {
    expect(WIZARD_STEPS.map((s) => s.key)).toEqual(["park", "age", "make"]);
    expect(WIZARD_STEPS.map((s) => s.label)).toEqual(["Park", "Explorer", "Make it"]);
    expect(stepAnnouncement("park")).toBe("Step 1 of 3: Pick your park");
    expect(stepAnnouncement("age")).toBe("Step 2 of 3: Who's exploring?");
    expect(stepAnnouncement("make")).toBe("Step 3 of 3: Make your pass");
  });

  it("the step trail marks the current step (aria-current) and the done ones", () => {
    const html = renderToStaticMarkup(<StepTrail step="age" />);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="step"[^]*Explorer/);
    expect(html).toContain("Park<span class=\"sr-only\"> (done)</span>");
    const done = renderToStaticMarkup(<StepTrail step="make" finished />);
    expect(done).not.toContain('aria-current="step"');
    expect(done.match(/\(done\)/g)).toHaveLength(3);
  });

  it("step 3's heading follows the real request", () => {
    expect(makeTitle({ kind: "idle" })).toBe("Make your pass");
    expect(makeTitle({ kind: "working", steps: [], startedAt: 0 })).toBe("Making your pass…");
    expect(makeTitle({ kind: "failed", code: "DAILY_LIMIT", message: "x" })).toBe("Make your pass");
  });
});

describe("the making checklist ticks only what really happened", () => {
  it("before the first server step, nothing is done or in progress", () => {
    expect(checklistRows([]).map((r) => r.state)).toEqual(["todo", "todo", "todo", "todo"]);
    expect(checklistRows([]).map((r) => r.text)).toEqual(MAKING_PLAN.map((p) => p.label));
  });

  it("the newest real step is in progress, the earlier ones done, the later ones still to come, with the server's own text", () => {
    const rows = checklistRows([real("map"), real("wildlife")]);
    expect(rows.map((r) => r.state)).toEqual(["done", "active", "todo", "todo"]);
    expect(rows[0].text).toBe("Reading the park map (OpenStreetMap)…");
    expect(rows[1].text).toBe("Checking what people spotted nearby in the last 14 days (iNaturalist)…");
    expect(rows[2].text).toBe("Write the clues");
  });

  it("a retry after checking goes back to writing (its own text), and checking is still to come", () => {
    const retry = { step: "retry" as const, text: "A few clues didn't pass the checks. Asking the model for a few more…" };
    const rows = checklistRows([real("map"), real("wildlife"), real("clues"), real("check"), retry]);
    expect(rows.map((r) => r.state)).toEqual(["done", "done", "active", "todo"]);
    expect(rows[2].text).toBe(retry.text);
  });

  it("the last step is ticked only when the pass really came back", () => {
    const steps = [real("map"), real("wildlife"), real("clues"), real("check")];
    expect(checklistRows(steps).at(-1)!.state).toBe("active");
    expect(checklistRows(steps, true).map((r) => r.state)).toEqual(["done", "done", "done", "done"]);
  });

  it("no percentages or made-up timers in the checklist", () => {
    const html = renderToStaticMarkup(<MakingChecklist steps={[real("map")]} />);
    expect(html).not.toMatch(/\d+\s?%/);
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain("Reading the park map (OpenStreetMap)…");
    expect(html).toContain(" In progress.");
    expect(html.match(/ Not started yet\./g)).toHaveLength(3);
  });
});

describe("the making picture follows the real steps", () => {
  it("each part appears only once its step started; it is decorative", () => {
    expect(sceneStage([])).toBe(-1);
    expect(sceneStage([real("map"), real("wildlife")])).toBe(1);
    expect(sceneStage([real("map"), real("wildlife"), real("clues"), real("check"), { step: "retry", text: "x" }])).toBe(2);
    const none = renderToStaticMarkup(<MakingScene stage={-1} />);
    expect(none).toContain('aria-hidden="true"');
    expect(none).not.toContain('data-part="map"');
    expect(none).not.toContain('data-part="butterfly"');
    const map = renderToStaticMarkup(<MakingScene stage={0} />);
    expect(map).toContain('data-part="map"');
    expect(map).not.toContain('data-part="butterfly"');
    expect(renderToStaticMarkup(<MakingScene stage={1} />)).toContain('data-part="butterfly"');
    expect(renderToStaticMarkup(<MakingScene stage={3} />)).not.toContain('data-part="burst"');
    expect(renderToStaticMarkup(<MakingScene stage={3} ready />)).toContain('data-part="burst"');
  });
});

describe("prefers-reduced-motion", () => {
  /** globals.css without its `@media (prefers-reduced-motion: no-preference) { ... }` blocks. */
  function withoutMotionBlocks(css: string): string {
    let out = "";
    let i = 0;
    const open = "@media (prefers-reduced-motion: no-preference)";
    for (;;) {
      const at = css.indexOf(open, i);
      if (at < 0) return out + css.slice(i);
      out += css.slice(i, at);
      let depth = 0;
      let j = css.indexOf("{", at);
      for (; j < css.length; j++) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}" && --depth === 0) break;
      }
      i = j + 1;
    }
  }

  it("every wizard animation runs only when motion is OK (the still version shows each part in its final pose)", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(".gp-wiz-write");
    const still = withoutMotionBlocks(css);
    const rules = [...still.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => /gp-wiz|gp-skeleton/.test(sel));
    expect(rules.length).toBeGreaterThan(0);
    for (const [, sel, body] of rules) expect(body, sel.trim()).not.toMatch(/animation\s*:/);
  });
});

describe("sign-in resume keeps the choices through the round trip", () => {
  const store = new Map<string, string>();
  const park: Park = { id: "way/188145317", name: "Celebration Park", kind: "park", lat: 33.10824, lng: -96.62468, distanceM: 120 };
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });
  function stubWindow() {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  }

  it("the park + age saved before sign-in come back once", async () => {
    stubWindow();
    rememberForSignIn(park, "10-13");
    expect(store.has(RESUME_KEY)).toBe(true);
    expect(await takeResume()).toEqual({ park, band: "10-13" });
    expect(await takeResume()).toBeNull();
  });

  it("anything that isn't a real park and age is ignored", async () => {
    stubWindow();
    store.set(RESUME_KEY, JSON.stringify({ park: { ...park, id: "javascript:alert(1)" }, band: "6-10" }));
    expect(await takeResume()).toBeNull();
    store.set(RESUME_KEY, JSON.stringify({ park, band: "99+" }));
    expect(await takeResume()).toBeNull();
  });
});
