/**
 * Decorative lawn strip (option C "Lawn bank", Kevin's pick): soft curved blades in logo B's style on a rolling
 * green bank, with a few tiny flowers. Drawn as a CSS background from one static SVG per theme (--grass-strip in
 * src/styles/tokens.css; files written by scripts/render-brand.mjs from src/components/art/grass.ts).
 * Hidden from assistive tech; no JS, no animation.
 */
export function GrassDivider({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" data-testid="grass-divider" className={`grass-strip w-full ${className}`.trim()} />;
}
