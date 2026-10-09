/**
 * "How was this pass?" (Kevin, 2026-10-08): signed in, 5 star radios and the 5 tag chips, no text box anywhere;
 * signed out, only "Sign in to rate this pass" (a link back to this pass). Screen only (print:hidden).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PassFeedback } from "@/components/pass/PassFeedback";
import { FEEDBACK_COPY, FEEDBACK_TAG_LABELS, FEEDBACK_TAGS } from "@/lib/feedback/kinds";

const ID = "w188145317-6to10-20261008-1";

describe("PassFeedback", () => {
  it("signed in: stars as native radios with names, the tag chips as toggle buttons, and no free text at all", () => {
    const html = renderToStaticMarkup(<PassFeedback passId={ID} signedIn />);
    expect(html).toContain(FEEDBACK_COPY.heading);
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    for (const n of ["1 star", "2 stars", "3 stars", "4 stars", "5 stars"]) expect(html).toContain(n);
    for (const t of FEEDBACK_TAGS) expect(html).toMatch(new RegExp(`<button type="button" aria-pressed="false"[^>]*>${FEEDBACK_TAG_LABELS[t]}</button>`));
    expect(html).toContain("Send rating");
    expect(html).not.toMatch(/<textarea|type="text"|contenteditable/i);
    expect(html).toContain('role="status"');
    expect(html).toContain("print:hidden");
    expect(html).toContain(FEEDBACK_COPY.privacy);
  });

  it("signed out: a sign-in link that comes back to this pass, and no form", () => {
    const html = renderToStaticMarkup(<PassFeedback passId={ID} signedIn={false} />);
    expect(html).toContain(FEEDBACK_COPY.signedOut);
    expect(html).toContain(`href="/signin?from=${encodeURIComponent(`/pass/${ID}`)}"`);
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="radio"');
  });

  it("a 13+ pass says \"We loved it\" (the same tag), and nothing says grown-up", () => {
    const html = renderToStaticMarkup(<PassFeedback passId={ID} signedIn adult />);
    expect(html).toContain(">We loved it</button>");
    expect(html).not.toContain("Kids loved it");
    expect(renderToStaticMarkup(<PassFeedback passId={ID} signedIn={false} adult />)).not.toMatch(/grown-up/i);
  });

  it("the judge demo is told its ratings are only logged", () => {
    expect(renderToStaticMarkup(<PassFeedback passId={ID} signedIn judge />)).toContain("Judge demo ratings are logged for review, but they aren&#x27;t counted.");
  });
});
