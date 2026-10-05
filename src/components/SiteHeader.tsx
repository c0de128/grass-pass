import Link from "next/link";
import { Logo } from "@/components/art/BrandArt";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GrassDivider } from "@/components/ui/GrassDivider";

/** Site header: the Grass Pass logo (home link), the dark mode switch, and a grass strip below. */
export function SiteHeader() {
  return (
    <header className="w-full">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-5 pt-4 pb-2">
        <Link href="/" className="inline-flex min-h-11 items-center rounded-control" aria-label="Grass Pass home">
          <span className="block w-[200px] sm:w-[250px]">
            <Logo height={57} decorative eager />
          </span>
        </Link>
        <ThemeToggle />
      </div>
      <GrassDivider />
    </header>
  );
}
