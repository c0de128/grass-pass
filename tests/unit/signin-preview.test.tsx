/**
 * Sign-in v2 (Kevin's option A "show the reward", 2026-10-08): the /signin preview is a REAL pinned pass, read from
 * src/data/pinned-examples/white-rock.json, never typed in; with no loadable pass it shows nothing at all.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import raw from "@/data/pinned-examples/white-rock.json";
import { SignInPassPreview } from "@/components/account/SignInPassPreview";
import { previewFinds, SIGNIN_PREVIEW_SLUG, signInPreview, signInPreviewFor } from "@/lib/accounts/signin-preview";
import { formatTime } from "@/lib/pass/format";
import { PassSchema } from "@/lib/pass/schema";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const file = raw as unknown as { pass: { park: { name: string }; items: { clue: string; section: string }[]; spot: { riddle: string }; generatedAt: string; id: string } };

describe("sign-in preview data", () => {
  it("is the pinned White Rock pass, every shown line taken from the file", () => {
    expect(SIGNIN_PREVIEW_SLUG).toBe("white-rock");
    const p = signInPreviewFor();
    expect(p).not.toBeNull();
    if (!p) return;
    expect(p.parkName).toBe(file.pass.park.name);
    expect(p.parkName).toBe("White Rock Lake Park");
    expect(p.place).toBe("Dallas, TX");
    expect(p.band).toBe("Ages 6–10");
    expect(p.madeAt).toBe(formatTime(file.pass.generatedAt));
    expect(p.href).toBe(`/pass/${file.pass.id}?example=1`);
    expect(p.riddle).toBe(file.pass.spot.riddle);
    expect(p.total).toBe(file.pass.items.length);
    const clues = file.pass.items.map((i) => i.clue);
    expect(p.finds).toHaveLength(2);
    for (const f of p.finds) expect(clues).toContain(f.clue);
    // A Park Find first (a counted one), then a Wild Find.
    expect(p.finds.map((f) => f.section)).toEqual(["park", "wild"]);
    expect(p.finds[0].clue).toMatch(/\b3\b/);
  });

  it("null for no pass, an unknown example, or a pass that isn't complete (never a half or fake pass)", () => {
    expect(signInPreview(null)).toBeNull();
    expect(signInPreviewFor("no-such-park")).toBeNull();
    const full = PassSchema.parse(file.pass);
    const short = { ...full, items: full.items.slice(0, 3) };
    expect(signInPreview(short)).toBeNull();
    expect(signInPreview({ ...full, generatedAt: "not a date" })).toBeNull();
  });

  it("previewFinds still gives real items when a pass has only one kind of find", () => {
    const full = PassSchema.parse(file.pass);
    const parkOnly = { ...full, items: full.items.filter((i) => i.section === "park") };
    const finds = previewFinds(parkOnly);
    expect(finds).toHaveLength(2);
    for (const f of finds) expect(parkOnly.items).toContain(f);
  });
});

describe("<SignInPassPreview>", () => {
  it("renders the real park, age band, clues, riddle and a dated 'A real pass' caption", () => {
    const p = signInPreviewFor();
    const t = text(renderToStaticMarkup(<SignInPassPreview preview={p} />));
    expect(t).toContain("White Rock Lake Park");
    expect(t).toContain("Ages 6–10");
    for (const f of p?.finds ?? []) expect(t).toContain(f.clue);
    expect(t).toContain(file.pass.spot.riddle);
    expect(t).toContain(`A real pass: White Rock Lake Park, Dallas, TX, made ${formatTime(file.pass.generatedAt)}.`);
    expect(t).toContain("See the whole pass");
    expect(t).toContain(`+${file.pass.items.length - 2} more finds`);
  });

  it("renders nothing at all when the pinned pass can't be loaded", () => {
    expect(renderToStaticMarkup(<SignInPassPreview preview={null} />)).toBe("");
    expect(renderToStaticMarkup(<SignInPassPreview preview={signInPreviewFor("no-such-park")} />)).toBe("");
  });
});
