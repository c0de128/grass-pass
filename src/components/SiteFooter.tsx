import { ArrowUpRight, Ticket } from "lucide-react";
import Link from "next/link";
import { FooterLandscape } from "@/components/site/FooterLandscape";
import { Logo } from "@/components/site/Logo";
import { ILLUSTRATION_CREDIT } from "@/lib/illustrations";
import { pinnedPass } from "@/lib/pinned";
import { REPO_URL } from "@/lib/site-url";

type FooterLink = { href: string; label: string; external?: boolean; pass?: boolean };

/**
 * The example parks the footer links to: each one's PINNED pass (src/lib/pinned.ts), a real complete pass committed in
 * src/data/pinned-examples/ that the pass page always opens (with or without the store). A park with no pinned pass
 * (Arbor Hills today) is left out, never a dead link. The order matches the home page's example cards.
 */
const FOOTER_PARKS = ["white-rock", "celebration", "oak-point"] as const;

export function footerParkLinks(slugs: readonly string[] = FOOTER_PARKS): FooterLink[] {
  return slugs.flatMap((slug) => {
    const pass = pinnedPass(slug);
    return pass ? [{ href: `/pass/${pass.id}?example=1`, label: pass.park.name, pass: true }] : [];
  });
}

/** Kevin's three columns (2026-10-07): LEARN / EXPLORE / RESOURCES. Every link goes to a real page or section. */
export function footerColumns(): Array<{ id: string; title: string; links: FooterLink[] }> {
  return [
    {
      id: "learn",
      title: "Learn",
      links: [
        { href: "/about", label: "About" },
        { href: "/how-it-works", label: "How it works" },
        { href: "/#pass", label: "What's a pass?" },
        { href: "/#why", label: "Why Grass Pass" },
        { href: "/how-it-works#why-open", label: "Why an open model" },
      ],
    },
    {
      id: "explore",
      title: "Explore",
      links: [{ href: "/#find", label: "Make a pass" }, ...footerParkLinks(), { href: "/#parks", label: "All example parks" }],
    },
    {
      id: "resources",
      title: "Resources",
      links: [
        { href: REPO_URL, label: "Source on GitHub (MIT)", external: true },
        { href: "/about#privacy", label: "Privacy" },
        { href: "/about#credits", label: "Photo credits and licences" },
      ],
    },
  ];
}

const link =
  "group/fl inline-flex min-h-9 items-start justify-center gap-2 rounded-sm py-1.5 text-[15px] leading-snug font-medium text-footer-foreground/90 transition-colors hover:text-footer-foreground";
const underline =
  "box-decoration-clone bg-[linear-gradient(var(--gp-footer-heading),var(--gp-footer-heading))] bg-[length:0%_2px] bg-left-bottom bg-no-repeat pb-0.5 transition-[background-size] duration-300 group-hover/fl:bg-[length:100%_2px] group-focus-visible/fl:bg-[length:100%_2px]";
const credit = "underline underline-offset-2 hover:text-footer-foreground";

function FooterItem({ l }: { l: FooterLink }) {
  // An external link's arrow stays on the same line as its last word.
  const cut = l.label.lastIndexOf(" ");
  const head = l.label.slice(0, cut);
  const tail = l.label.slice(cut + 1);
  const body = (
    <>
      {l.pass ? <Ticket aria-hidden="true" className="mt-0.5 size-4 shrink-0 -rotate-12 text-footer-heading" strokeWidth={2.25} /> : null}
      <span className={underline}>
        {l.external ? (
          <>
            {head}{" "}
            <span className="whitespace-nowrap">
              {tail}
              <ArrowUpRight aria-hidden="true" className="ml-1 inline size-4 align-[-2px] text-footer-heading" />
            </span>
          </>
        ) : (
          l.label
        )}
      </span>
    </>
  );
  return l.external ? (
    <a className={link} href={l.href}>
      {body}
    </a>
  ) : (
    <Link className={link} href={l.href} prefetch={false}>
      {body}
    </Link>
  );
}

/**
 * Site footer (Kevin, 2026-10-07, "make the footer pop", after his landscape reference): a hand-drawn ridge with a family
 * and a big oak fading into a deep forest-green band, Kevin's three link columns (LEARN / EXPLORE / RESOURCES), his
 * closing line with the logo, and every data, model, font and picture credit (licence obligations, unchanged).
 * Everything under the picture is centred (Kevin 2026-10-07).
 * Never printed (the printed pass carries its own sources on the parent stub).
 */
export function SiteFooter() {
  const columns = footerColumns();
  return (
    <footer className="gp-band mt-auto w-full text-footer-foreground print:hidden">
      <div className="relative h-[clamp(130px,16.25vw,320px)] overflow-hidden">
        <FooterLandscape />
      </div>
      <div className="relative -mt-1 bg-footer">
        <div className="mx-auto flex max-w-7xl flex-col px-5 pt-6 pb-12 md:px-8 lg:pt-4">
          <nav aria-label="Footer">
            <div className="grid gap-y-9 sm:grid-cols-3">
              {columns.map((col, i) => (
                <div
                  key={col.id}
                  className={
                    i === 0
                      ? "text-center sm:px-8 lg:px-12"
                      : "border-t border-footer-foreground/15 pt-8 text-center sm:border-t-0 sm:border-l sm:px-8 sm:pt-0 lg:px-12"
                  }
                >
                  <h2 id={`footer-${col.id}`} className="font-heading text-base font-extrabold tracking-[0.16em] text-footer-heading uppercase">
                    {col.title}
                  </h2>
                  <ul aria-labelledby={`footer-${col.id}`} className={`mt-3 grid justify-items-center gap-x-4 gap-y-0.5 sm:mt-4 ${col.id === "learn" ? "grid-cols-2 sm:grid-cols-1" : ""}`}>
                    {col.links.map((l) => (
                      <li key={l.href}>
                        <FooterItem l={l} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </nav>

          <div className="mt-12 flex flex-col items-center gap-5 border-t-2 border-dashed border-footer-foreground/20 pt-9 text-center">
            {/* Not a link: the header's logo is the one "Grass Pass home" link on every page. */}
            <Logo inverted notchClassName="bg-footer" className="shrink-0" />
            {/* Kevin's closing line, word for word; the sign-off ("Touch Grass" added 2026-10-07) set large, each sentence kept whole. */}
            <p className="flex flex-col items-center gap-2 text-base leading-relaxed text-footer-foreground/90 sm:text-lg" data-testid="footer-closing">
              <span>© 2026 Grass Pass. An AI-powered service dedicated to real-world family exploration.</span>{" "}
              <span className="font-heading text-[1.75rem] leading-[1.05] font-extrabold tracking-tight sm:text-4xl lg:text-[2.75rem]">
                <span className="whitespace-nowrap text-footer-heading">Pocket the pencil.</span> <span className="whitespace-nowrap text-footer-foreground">Leave the phone.</span>{" "}
                <span className="whitespace-nowrap text-footer-heading">Touch Grass</span>
              </span>
            </p>
          </div>

          <p className="mx-auto mt-8 max-w-5xl text-center text-xs leading-relaxed text-footer-muted">
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
      </div>
    </footer>
  );
}
