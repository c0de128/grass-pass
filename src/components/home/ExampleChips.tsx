import Link from "next/link";
import type { ReadyExample } from "@/lib/home/showcase";

/** "Arbor Hills Nature Preserve" -> "Arbor Hills", "White Rock Lake Park" -> "White Rock Lake" (short pill labels). */
export function shortParkName(name: string): string {
  return name.replace(/ Nature Preserve$| Preserve$/, "").replace(/ Lake Park$/, " Lake");
}

/**
 * Phones only (R1 UX m8): the ready example passes as a compact row of pills under the hero text, so a first-time
 * visitor at 360 px sees a real pass is one tap away above the fold (in the v0 layout the hero pass card is far
 * below the search card on a phone). Hidden from 640 px up. Nothing is shown when no example is ready.
 */
export function ExampleChips({ examples }: { examples: readonly ReadyExample[] }) {
  if (examples.length === 0) return null;
  return (
    <nav aria-label="Open an example pass" className="-mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 sm:hidden">
      <span className="text-sm font-semibold text-muted-foreground">Just looking? Open a real pass:</span>
      <ul className="contents">
        {examples.map((ex) => (
          <li key={ex.example.slug}>
            <Link
              href={ex.href}
              prefetch={false}
              className="inline-flex min-h-9 items-center rounded-full bg-card px-3 text-sm font-semibold text-ink ring-1 ring-line hover:bg-muted"
            >
              {shortParkName(ex.example.name)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
