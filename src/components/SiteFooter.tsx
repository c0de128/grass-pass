import Link from "next/link";
import { GrassDivider } from "@/components/ui/GrassDivider";
import { REPO_URL } from "@/lib/site-url";

/**
 * Site footer: data and model credits in one line, the About link and the source code link.
 * Never printed (the printed pass carries its own sources on the parent stub).
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto w-full print:hidden">
      <GrassDivider />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-6 text-sm text-muted">
        <p>
          Park map data ©{" "}
          <a className="underline underline-offset-2" href="https://www.openstreetmap.org/copyright">
            OpenStreetMap
          </a>{" "}
          contributors (ODbL) · Wildlife sightings from{" "}
          <a className="underline underline-offset-2" href="https://www.inaturalist.org/">
            iNaturalist
          </a>{" "}
          observers · Species summaries from Wikipedia (CC BY-SA) · Clues written by an open model (Gemma 4 by default,
          Apache-2.0) · Fonts Fredoka and Nunito (SIL OFL 1.1).
        </p>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            <li>
              <Link className="inline-flex min-h-11 items-center font-bold underline underline-offset-2" href="/about">
                About Grass Pass
              </Link>
            </li>
            <li>
              <a className="inline-flex min-h-11 items-center font-bold underline underline-offset-2" href={REPO_URL}>
                Source code on GitHub (MIT)
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
