import Link from "next/link";
import type { ReadyExample } from "@/lib/home/showcase";

/**
 * "Arbor Hills Nature Preserve" -> "Arbor Hills", "White Rock Lake Park" -> "White Rock Lake", "Oak Point Park and Nature
 * Preserve" -> "Oak Point" (short pill labels; the 360 px screenshot of 2026-10-07 showed "Oak Point Park and").
 */
export function shortParkName(name: string): string {
  return name.replace(/ Park and Nature Preserve$| and Nature Preserve$| Nature Preserve$| Preserve$/, "").replace(/ Lake Park$/, " Lake");
}

/**
 * Phones only (R1 UX m8): the ready example passes as a compact row of pills, one tap from a real pass. Kevin
 * 2026-10-08 (UX-8-03): it sits under the search box, so "Create your pass now" is first on a phone. Hidden from
 * 640 px up. Nothing is shown when no example is ready.
 */
export function ExampleChips({ examples }: { examples: readonly ReadyExample[] }) {
  if (examples.length === 0) return null;
  return (
    <nav aria-label="Open an example pass" className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:hidden">
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
