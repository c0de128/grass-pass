/**
 * Real, freely licensed photos of the four example parks (Kevin's decision B, 2026-10-06), shown on the home page
 * (sample park cards and the "Why generic hunts fail" band). Each one was checked on its source page on
 * 2026-10-06: the licence (CC0 or CC BY only; no NC/ND), the author, and that the title/description name THAT park.
 * Converted to WebP in public/photos (resized, not cropped; the page crops with object-fit).
 * Every photo shows a visible "Photo: <author>, <licence>" credit; the linked credits are under the cards and on /about.
 */
export type ParkPhoto = {
  src: string;
  width: number;
  height: number;
  /** Honest alt text: what the photo really shows. */
  alt: string;
  /** The title on the source page. */
  title: string;
  author: string;
  licence: "CC0 1.0" | "CC BY 2.0";
  licenceUrl: string;
  sourceUrl: string;
  /** When it was taken, as the source page says. */
  taken: string;
};

const CC_BY_2 = "https://creativecommons.org/licenses/by/2.0/";
const CC0 = "https://creativecommons.org/publicdomain/zero/1.0/";

/** Keyed by example park slug (src/lib/prewarm.ts EXAMPLE_PARKS). */
export const PARK_PHOTOS: Record<string, ParkPhoto> = {
  "arbor-hills": {
    src: "/photos/arbor-hills.webp",
    width: 1400,
    height: 1050,
    alt: "A view down a wooded slope at Arbor Hills Nature Preserve: green trees on both sides and a grassy meadow below",
    title: "Arbor Hills Nature Preserve (trail vista)",
    author: "Robert Nunnally",
    licence: "CC BY 2.0",
    licenceUrl: CC_BY_2,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Arbor_Hills_Nature_Preserve.jpg",
    taken: "March 2008",
  },
  "white-rock": {
    src: "/photos/white-rock-lake.webp",
    width: 1400,
    height: 788,
    alt: "White Rock Lake in Dallas on a sunny day, seen from the grassy shore path with reeds at the water's edge",
    title: "Dallas Texas - HCP - September 21, 2022 - 007 - White Rock Lake",
    author: "Vulturesong",
    licence: "CC0 1.0",
    licenceUrl: CC0,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Dallas_Texas_-_HCP_-_September_21,_2022_-_007_-_White_Rock_Lake.jpg",
    taken: "September 2022",
  },
  celebration: {
    src: "/photos/celebration-park.webp",
    width: 1024,
    height: 768,
    alt: "A paved walking trail curving through autumn trees at Celebration Park in Allen, Texas",
    title: "Sunday morning walk (Celebration Park, Allen, Texas, November 20, 2011)",
    author: "Robert Nunnally",
    licence: "CC BY 2.0",
    licenceUrl: CC_BY_2,
    sourceUrl: "https://www.flickr.com/photos/46183897@N00/6369488567/",
    taken: "November 2011",
  },
  // Judge R7 T1: the 4th example since 2026-10-06 (src/lib/prewarm.ts). Checked on its source page on 2026-10-06: CC0,
  // author Jackilometresan, title and description name Oak Point Park & Nature Preserve, Plano.
  "oak-point": {
    src: "/photos/oak-point.webp",
    width: 1024,
    height: 768,
    alt: "Rowlett Creek in Oak Point Park, Plano: a calm green creek between steep muddy banks, framed by tree trunks and spring leaves",
    title: "Rowlett Creek in Oak Point Park, Plano, Texas, USA",
    author: "Jackilometresan",
    licence: "CC0 1.0",
    licenceUrl: CC0,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Rowlett_Creek_in_Oak_Point_Park,_Plano,_Texas,_USA.jpg",
    taken: "April 2021",
  },
  // Still used by the "two parks" band (a measurement, not an example pass).
  connemara: {
    src: "/photos/connemara-meadow.webp",
    width: 1024,
    height: 768,
    alt: "Connemara Meadow in spring: a field of yellow wildflowers with tall grass and trees behind",
    title: "Connemara Meadow (May 2, 2015, during the monthly bird walk)",
    author: "Robert Nunnally",
    licence: "CC BY 2.0",
    licenceUrl: CC_BY_2,
    sourceUrl: "https://www.flickr.com/photos/46183897@N00/17345556215/",
    taken: "May 2015",
  },
};

/** The short visible credit on a photo. */
export function photoCredit(p: ParkPhoto): string {
  return `Photo: ${p.author}, ${p.licence}`;
}
