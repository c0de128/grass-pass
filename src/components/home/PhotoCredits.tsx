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
 * Linked credits for the given park photos (or all of them), e.g. under the sample park cards. UX-5-07: grouped by
 * licence, so each photo is one link (its source page, which names the author) and each licence is linked once
 * ("A by X, B by X (CC BY 2.0) · C by Y (CC0 1.0)"): fewer Tab stops, the same attribution. /about keeps one full
 * line per photo (PhotoCreditLine).
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
  return (
    <p className={className} data-testid="photo-credits">
      Photos:{" "}
      {groups.map((g, gi) => (
        <span key={g.licenceUrl}>
          {gi > 0 ? " · " : null}
          {g.photos.map((p, i) => (
            <span key={p.src}>
              {i > 0 ? ", " : null}
              <a className={link} href={p.sourceUrl}>
                {p.title}
              </a>{" "}
              by {p.author} ({p.taken})
            </span>
          ))}{" "}
          (
          <a className={link} href={g.licenceUrl}>
            {g.licence}
          </a>
          )
        </span>
      ))}
      .
    </p>
  );
}
