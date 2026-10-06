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

/** Linked credits for the given park photos (or all of them), e.g. under the sample park cards and on /about. */
export function PhotoCredits({ slugs, className = "" }: { slugs?: readonly string[]; className?: string }) {
  const photos = (slugs ?? Object.keys(PARK_PHOTOS)).map((s) => PARK_PHOTOS[s]).filter((p): p is ParkPhoto => Boolean(p));
  if (photos.length === 0) return null;
  return (
    <p className={className} data-testid="photo-credits">
      Photos:{" "}
      {photos.map((p, i) => (
        <span key={p.src}>
          {i > 0 ? " · " : null}
          <PhotoCreditLine photo={p} />
        </span>
      ))}
      .
    </p>
  );
}
