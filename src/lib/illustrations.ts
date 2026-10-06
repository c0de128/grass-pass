/**
 * The hero picture: the AI-generated illustration from Kevin's v0 design (made with v0 by Vercel), converted to
 * WebP. It is not a photo of a real place or child, so it carries a visible caption and an alt text that says so
 * (Kevin's honesty rule). The four park pictures are real, freely licensed photos: src/data/photo-credits.ts.
 */
export type Illustration = {
  src: string;
  width: number;
  height: number;
  /** Honest alt text: what the picture shows, and that it is an illustration. */
  alt: string;
  /** The short visible caption on the picture. */
  caption: string;
};

export const HERO_ILLUSTRATION: Illustration = {
  src: "/illustrations/hero-kid.webp",
  width: 768,
  height: 1376,
  alt: "AI-generated illustration: a child kneels in a wildflower meadow with a paper checklist and a pencil, looking at a butterfly",
  caption: "AI illustration",
};

/** Credit line for the footer and /about. */
export const ILLUSTRATION_CREDIT = "Hero illustration generated with v0 by Vercel (AI), not a photo.";
