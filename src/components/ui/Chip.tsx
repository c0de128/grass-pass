import type { ComponentType, ReactNode, SVGProps } from "react";
import { ButterflyIcon, MagnifierIcon, MapXIcon, PawIcon, PinIcon } from "@/components/art/icons";

export type SectionKind = "park" | "wild" | "lucky" | "spot" | "october";

export const SECTION_LABELS: Record<SectionKind, string> = {
  park: "Park Finds",
  wild: "Wild Finds",
  lucky: "Lucky Finds",
  spot: "Find This Spot",
  october: "October special",
};

const ICONS: Record<SectionKind, ComponentType<SVGProps<SVGSVGElement>>> = {
  park: PinIcon,
  wild: MagnifierIcon,
  lucky: PawIcon,
  spot: MapXIcon,
  october: ButterflyIcon,
};

/** Section chip: mint background + ink text (10.39:1) with a flat icon (SPEC §8.3). */
export function Chip({ kind, children, className = "" }: { kind: SectionKind; children?: ReactNode; className?: string }) {
  const IconFor = ICONS[kind];
  return (
    <span
      data-kind={kind}
      className={`inline-flex items-center gap-1.5 rounded-full bg-chip px-3 py-1 text-sm font-bold text-on-chip ${className}`}
    >
      <IconFor className="h-4 w-4 shrink-0" />
      <span>{children ?? SECTION_LABELS[kind]}</span>
    </span>
  );
}
