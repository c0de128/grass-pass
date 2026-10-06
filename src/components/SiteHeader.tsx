import Link from "next/link";
import { Logo } from "@/components/art/BrandArt";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GrassDivider } from "@/components/ui/GrassDivider";

/** Site header: the Grass Pass logo (home link), the About link, the dark mode switch, and a grass strip below. */
export function SiteHeader() {
  return (
    <header className="w-full">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-5 pt-4 pb-2">
        {/* min-w-0 + max-w-full: at 360 px the logo gives up a few px for the About link instead of overflowing. */}
        <Link href="/" className="inline-flex min-h-11 min-w-0 shrink items-center rounded-control" aria-label="Grass Pass home">
          <span className="block w-[200px] max-w-full sm:w-[250px]">
            <Logo height={57} decorative eager />
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3 print:hidden">
          <nav aria-label="Site">
            <Link
              href="/about"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-2.5 font-bold text-heading underline-offset-4 hover:underline sm:px-3"
            >
              About
            </Link>
          </nav>
          <ThemeToggle />
        </div>
      </div>
      <GrassDivider />
    </header>
  );
}
