import type { InputHTMLAttributes } from "react";

const sizes = {
  md: "h-12 text-base",
  sm: "h-10 text-sm",
};

// 16px text on the normal size on purpose: anything smaller makes iPhones zoom in on focus.
export function Input({
  className = "",
  size = "md",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: keyof typeof sizes }) {
  return (
    <input
      className={`w-full rounded-xl border border-line bg-surface px-4 text-ink placeholder:text-ink-soft/70 focus:border-spruce focus:outline-none focus:ring-2 focus:ring-spruce/25 ${sizes[size]} ${className}`}
      {...props}
    />
  );
}
