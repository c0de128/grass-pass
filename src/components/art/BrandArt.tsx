// Brand art as static SVG files rendered by scripts/render-brand.mjs (sources: scripts/brand/art.mjs).
// Served from /public so the browser caches them; unoptimized because they are already vector.
import Image from "next/image";

/** Horizontal logo sizes: viewBox 394x90 (see public/logo-header.svg). */
export const LOGO_RATIO = 394 / 90;

/**
 * "Grass Pass: your ticket to get outside" logo. Swaps to the reversed (cream) logo in dark mode.
 * `decorative` hides it from assistive tech when nearby text already says the name.
 */
export function Logo({ height = 48, decorative = false, eager = false }: { height?: number; decorative?: boolean; eager?: boolean }) {
  const width = Math.round(height * LOGO_RATIO);
  const alt = decorative ? "" : "Grass Pass: your ticket to get outside";
  return (
    <>
      <Image
        src="/logo-header.svg"
        alt={alt}
        width={width}
        height={height}
        unoptimized
        loading={eager ? "eager" : "lazy"}
        className="only-light h-auto max-w-full"
      />
      <Image
        src="/logo-header-dark.svg"
        alt={alt}
        width={width}
        height={height}
        unoptimized
        loading={eager ? "eager" : "lazy"}
        className="only-dark h-auto max-w-full"
      />
    </>
  );
}

/** Ticket mark only (the app icon shape). Decorative. */
export function TicketMark({ size = 48 }: { size?: number }) {
  return (
    <Image src="/brand/ticket-mark.svg" alt="" aria-hidden="true" width={size} height={Math.round((size * 90) / 120)} unoptimized />
  );
}

/** Flat explorer scene (kid with a magnifying glass, sunflower, hill). Decorative: text does the work. */
export function ExplorerScene({ className = "", width = 378 }: { className?: string; width?: number }) {
  return (
    <Image
      src="/brand/explorer-scene.svg"
      alt=""
      aria-hidden="true"
      width={width}
      height={Math.round((width * 648) / 756)}
      unoptimized
      className={`h-auto max-w-full ${className}`}
      data-testid="explorer-scene"
    />
  );
}
