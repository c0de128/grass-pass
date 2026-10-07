import { PARK_PHOTOS, type ParkPhoto } from "@/data/photo-credits";

const link = "underline underline-offset-2";

/** One photo's full credit: title (linked to its source page), author, licence (linked), date. */
export function PhotoCreditLine({ photo }: { photo: ParkPhoto }) {
  return (
    <>
      <a className={link} href={photo.sourceUrl}>
        {photo.title}
      </a>{" "}
      by {photo.author},{" "}
      <a className={link} href={photo.licenceUrl}>
        {photo.licence}
      </a>{" "}
      ({photo.taken})
    </>
  );
}

/**
 * The credits for the given park photos (or all of them), under the sample park cards. UX-6-04 (was UX-5-07): every
 * photo's title, author, date and licence is written out here as plain text, and ONE link ("Photo credits and
 * licences") goes to the full list on /about#credits, where each photo links its source page and its licence. One
 * Tab stop instead of one per photo and licence, with the same attribution on the page.
 */
export function PhotoCredits({ slugs, className = "" }: { slugs?: readonly string[]; className?: string }) {
  const photos = (slugs ?? Object.keys(PARK_PHOTOS)).map((s) => PARK_PHOTOS[s]).filter((p): p is ParkPhoto => Boolean(p));
  if (photos.length === 0) return null;
  const groups: { licence: string; licenceUrl: string; photos: ParkPhoto[] }[] = [];
  for (const p of photos) {
    const g = groups.find((x) => x.licenceUrl === p.licenceUrl);
    if (g) g.photos.push(p);
    else groups.push({ licence: p.licence, licenceUrl: p.licenceUrl, photos: [p] });
  }
  const text = groups
    .map((g) => `${g.photos.map((p) => `${p.title} by ${p.author} (${p.taken})`).join(", ")} (${g.licence})`)
    .join(" · ");
  return (
    <p className={className} data-testid="photo-credits">
      Photos: {text}.{" "}
      <a className={link} href="/about#credits">
        Photo credits and licences
      </a>
    </p>
  );
}
