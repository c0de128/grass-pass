import { useId } from "react";
import { DIVIDER_HEIGHT, DIVIDER_TILE_WIDTH, GRASS_BACK, dividerPath } from "@/components/art/grass";

const BACK = dividerPath("back");
const FRONT = dividerPath("front");

/**
 * Decorative strip of soft curved lawn-grass tufts in logo B's style (SPEC §8.3): darker back tufts, --lawn front
 * tufts, one seamless tile repeated across any width. Hidden from assistive tech.
 */
export function GrassDivider({ className = "" }: { className?: string }) {
  const id = `grass-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-testid="grass-divider"
      className={`block w-full text-lawn ${className}`}
      height={DIVIDER_HEIGHT}
    >
      <defs>
        <pattern id={id} width={DIVIDER_TILE_WIDTH} height={DIVIDER_HEIGHT} patternUnits="userSpaceOnUse">
          <path fill={GRASS_BACK} d={BACK} />
          <path fill="currentColor" d={FRONT} />
        </pattern>
      </defs>
      <rect width="100%" height={DIVIDER_HEIGHT} fill={`url(#${id})`} />
    </svg>
  );
}
