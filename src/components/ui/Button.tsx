import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary";

const BASE =
  "inline-flex min-h-12 min-w-11 items-center justify-center gap-2 rounded-2xl px-6 py-2 " +
  "font-heading text-base font-extrabold leading-tight transition-all " +
  "disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

const VARIANTS: Record<ButtonVariant, string> = {
  // v3 (Kevin's v0 "Find parks" button): grass green, white text (5.6:1), an ink "step" shadow that lifts on hover.
  // Dark mode: light green with dark text (7.9:1).
  primary:
    "bg-primary text-primary-foreground shadow-[0_4px_0_0_var(--gp-foreground)] hover:bg-primary-hover " +
    "motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-1 active:shadow-none",
  // White card button with a >= 3:1 outline.
  secondary: "bg-card text-foreground ring-2 ring-line ring-inset hover:bg-muted",
};

/** Class names for a button look, so links (`<a>` / `<Link>`) can match buttons. */
export function buttonClassName(variant: ButtonVariant = "primary", extra = ""): string {
  return `${BASE} ${VARIANTS[variant]}${extra ? ` ${extra}` : ""}`;
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant };

/** Brand button: at least 48 px tall, rounded, visible focus ring from the global :focus-visible style. */
export function Button({ variant = "primary", className = "", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClassName(variant, className)} {...rest} />;
}
