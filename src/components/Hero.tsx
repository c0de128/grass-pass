import type { ReactNode } from "react";
import { ExplorerScene } from "@/components/art/BrandArt";

/**
 * Landing hero in the banner's layout: text (headline + the form passed as children) on the left,
 * the flat explorer scene on the right. The scene is decorative and hidden under 480 px.
 */
export function Hero({ title, lead, children }: { title: ReactNode; lead?: ReactNode; children?: ReactNode }) {
  return (
    <section aria-labelledby="hero-title" className="grid items-end gap-6 min-[480px]:grid-cols-[1fr_minmax(0,40%)]">
      <div className="flex flex-col gap-4">
        <h1 id="hero-title" className="text-4xl font-bold sm:text-5xl">
          {title}
        </h1>
        {lead ? <p className="text-lg">{lead}</p> : null}
        {children}
      </div>
      <div className="hidden min-[480px]:block">
        <ExplorerScene />
      </div>
    </section>
  );
}
