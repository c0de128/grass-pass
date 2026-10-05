// Simple flat line icons for the pass sections (SPEC §8.3). 24x24, currentColor, decorative only.
import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "viewBox">;

function Icon({ children, className = "h-5 w-5", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Park Finds: a basketball hoop. */
export function HoopIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="3" width="16" height="10" rx="1.5" />
      <rect x="9" y="7" width="6" height="4" />
      <path d="M7.5 13h9" />
      <path d="M8.5 13l1.5 7M15.5 13L14 20M12 13v7M9.5 17h5" />
    </Icon>
  );
}

/** Wild Finds: a magnifying glass. */
export function MagnifierIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="6" />
      <path d="M14.5 14.5L20 20" strokeWidth={3} />
    </Icon>
  );
}

/** Lucky Finds: a paw print. */
export function PawIcon(props: IconProps) {
  return (
    <Icon {...props} fill="currentColor" stroke="none">
      <ellipse cx="6" cy="10" rx="2" ry="2.6" />
      <ellipse cx="10" cy="6.5" rx="2" ry="2.6" />
      <ellipse cx="14" cy="6.5" rx="2" ry="2.6" />
      <ellipse cx="18" cy="10" rx="2" ry="2.6" />
      <path d="M12 11.5c-3 0-6 4-6 6.5 0 1.6 1.3 2.5 3 2.2 1.1-.2 2-.6 3-.6s1.9.4 3 .6c1.7.3 3-.6 3-2.2 0-2.5-3-6.5-6-6.5z" />
    </Icon>
  );
}

/** Find This Spot: a folded map with an X. */
export function MapXIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
      <path d="M9 4v14M15 6v14" />
      <path d="M16.5 9.5l3 3M19.5 9.5l-3 3" />
    </Icon>
  );
}

/** October special: a butterfly (monarch season). */
export function ButterflyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 8v11" />
      <path d="M12 10C10 5 4 3.5 3.5 6.5S6 12.5 12 12.5" />
      <path d="M12 10c2-5 8-6.5 8.5-3.5S18 12.5 12 12.5" />
      <path d="M12 13.5c-2 0-6 1.5-5.5 4s3.5 1.5 5.5-2" />
      <path d="M12 13.5c2 0 6 1.5 5.5 4s-3.5 1.5-5.5-2" />
      <path d="M12 8l-2-3M12 8l2-3" />
    </Icon>
  );
}
