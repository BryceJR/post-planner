import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-spruce text-on-spruce hover:brightness-110",
  secondary: "border border-line bg-surface text-ink hover:bg-paper",
  ghost: "text-ink hover:bg-spruce-tint",
  danger: "bg-danger-tint text-danger hover:bg-danger hover:text-white",
};

const sizes: Record<ButtonSize, string> = {
  md: "h-12 px-5 text-base rounded-xl",
  sm: "h-10 sm:h-9 px-3.5 text-sm rounded-lg",
};

// Shared so links can look like buttons too (see link-button.tsx).
export function buttonClasses({
  variant = "primary",
  size = "md",
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return `inline-flex items-center justify-center gap-2 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spruce disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${sizes[size]} ${className}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClasses({ variant, size, className })} {...props} />;
}
