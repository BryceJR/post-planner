import type { SelectHTMLAttributes } from "react";

const sizes = {
  md: "h-12 text-base",
  sm: "h-10 text-sm",
};

export function Select({
  className = "",
  size = "md",
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: keyof typeof sizes }) {
  return (
    <select
      className={`${sizes[size]} w-full appearance-none rounded-xl border border-line bg-surface bg-[url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%2716%27%20height%3D%2716%27%20fill%3D%27none%27%20stroke%3D%27%235c6660%27%20stroke-width%3D%272%27%3E%3Cpath%20d%3D%27m4%206%204%204%204-4%27/%3E%3C/svg%3E")] bg-[length:16px] bg-[position:right_14px_center] bg-no-repeat pl-4 pr-10 text-ink focus:border-spruce focus:outline-none focus:ring-2 focus:ring-spruce/25 ${className}`}
      {...props}
    />
  );
}
