import { useId } from "react";
import { DIVIDER_HEIGHT, DIVIDER_TILE_WIDTH, dividerPath } from "@/components/art/grass";

const TILE = dividerPath(1);

/** Decorative strip of short straight lawn-grass blades (SPEC §8.3), one 40 px tile repeated. Hidden from assistive tech. */
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
          <path fill="currentColor" d={TILE} />
        </pattern>
      </defs>
      <rect width="100%" height={DIVIDER_HEIGHT} fill={`url(#${id})`} />
    </svg>
  );
}
