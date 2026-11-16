import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

// One look for every action. Hover and press apply only when the control can act (`interactive`),
// so disabled and aria-disabled buttons stay still; press nudges the button down (transform only).
const BASE = "inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap focus-ring "
  + "transition-[color,background-color,border-color,box-shadow,transform] duration-(--duration-fast) ease-out "
  + "interactive:active:translate-y-px interactive:active:scale-[0.98] "
  + "disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45";

const VARIANTS: Record<ButtonVariant, string> = {
  // One per view: the action the screen exists for.
  primary: "bg-accent text-white shadow-button interactive:hover:bg-accent-hover interactive:active:bg-accent-press interactive:active:shadow-pressed",
  secondary: "border border-line-strong bg-white/[0.03] text-ink interactive:hover:border-ink-faint interactive:hover:bg-white/[0.07] interactive:active:bg-white/[0.04]",
  ghost: "text-ink-muted interactive:hover:bg-white/[0.06] interactive:hover:text-ink interactive:active:bg-white/[0.04]",
  // Destructive, but not the screen's main action.
  danger: "border border-accent/55 text-accent-ink interactive:hover:border-accent interactive:hover:bg-accent-wash interactive:active:bg-accent/20",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-xs",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-sm",
};

// For links and labels that look like buttons.
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra = ""): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

// An inline text link: red ink, underline on hover.
export const linkClass = "rounded-sm font-semibold text-accent-ink underline-offset-4 transition-colors duration-(--duration-fast) hover:underline focus-ring";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize };

// For a disabled state that changes after load, pass `aria-disabled` and guard the click instead of
// `disabled`: Firefox restores a stale `disabled` on reload, which breaks hydration (frontend/AGENTS.md).
export default function Button({ variant = "secondary", size = "md", className = "", type = "button", ...props }: Props) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}
