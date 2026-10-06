import Link from "next/link";
import { Logo } from "@/components/site/Logo";
import { ILLUSTRATION_CREDIT } from "@/lib/illustrations";
import { REPO_URL } from "@/lib/site-url";

const link = "inline-flex min-h-11 items-center text-band-foreground/85 underline-offset-4 hover:text-band-foreground hover:underline";
const credit = "underline underline-offset-2 hover:text-band-foreground";

/**
 * v3 site footer (Kevin's v0 design): the dark band with the sunflower logo, the About / How it works /
 * source links, and every data, model, font and picture credit. Never printed (the printed pass carries
 * its own sources on the parent stub).
 */
export function SiteFooter() {
  return (
    <footer className="gp-band mt-auto w-full bg-band text-band-foreground print:hidden">
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-5 py-14 md:px-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <Logo inverted />
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-8 gap-y-1 text-sm font-medium">
              <li>
                <Link className={link} href="/about">
                  About
                </Link>
              </li>
              <li>
                <Link className={link} href="/how-it-works">
                  How it works
                </Link>
              </li>
              <li>
                <a className={link} href={REPO_URL}>
                  Source on GitHub (MIT)
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <p className="border-t border-band-foreground/15 pt-6 text-sm leading-relaxed text-band-muted">
          Map data ©{" "}
          <a className={credit} href="https://www.openstreetmap.org/copyright">
            OpenStreetMap
          </a>{" "}
          contributors (ODbL) · Sightings:{" "}
          <a className={credit} href="https://www.inaturalist.org/">
            iNaturalist
          </a>{" "}
          observers · Species facts: Wikipedia (CC BY-SA) · Lucky Finds: Google review counts via{" "}
          <a className={credit} href="https://serpapi.com/">
            SerpApi
          </a>{" "}
          · Clues: Gemma 4 by default (open model, Apache-2.0) · Icons: Lucide (ISC) · Fonts: Bricolage Grotesque and DM Sans (site),
          Fredoka and Nunito (print), SIL OFL 1.1 · Park photos: Robert Nunnally (CC BY 2.0) and Vulturesong (CC0), details on
          the{" "}
          <Link className={credit} href="/about#credits">
            About page
          </Link>{" "}
          · {ILLUSTRATION_CREDIT}
        </p>
      </div>
    </footer>
  );
}
