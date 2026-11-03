import type { TextareaHTMLAttributes } from "react";

export function Textarea({
  className = "",
  compact = false,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { compact?: boolean }) {
  return (
    <textarea
      className={`${compact ? "min-h-20" : "min-h-24"} w-full rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink placeholder:text-ink-soft/70 focus:border-spruce focus:outline-none focus:ring-2 focus:ring-spruce/25 ${className}`}
      {...props}
    />
  );
}
