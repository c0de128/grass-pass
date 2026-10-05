import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary";

const BASE =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control px-5 py-2 " +
  "font-display text-lg font-semibold leading-tight transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

const VARIANTS: Record<ButtonVariant, string> = {
  // forest + paper (7.99:1); dark mode: sun + ink (9.68:1)
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  // paper-light + forest border/text; dark mode: forest + mint border + paper text
  secondary: "border-2 border-line bg-surface text-heading hover:bg-secondary-hover",
};

/** Class names for a button look, so links (`<a>` / `<Link>`) can match buttons. */
export function buttonClassName(variant: ButtonVariant = "primary", extra = ""): string {
  return `${BASE} ${VARIANTS[variant]}${extra ? ` ${extra}` : ""}`;
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant };

/** Brand button: at least 44x44 px, 12 px radius, visible focus ring from the global :focus-visible style. */
export function Button({ variant = "primary", className = "", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClassName(variant, className)} {...rest} />;
}
