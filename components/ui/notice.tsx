import type { ReactNode } from "react";

export function Notice({ kind = "info", children }: { kind?: "info" | "error"; children: ReactNode }) {
  const styles =
    kind === "error"
      ? "border-danger/30 bg-danger-tint text-danger"
      : "border-spruce/30 bg-spruce-tint text-spruce-deep";
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}
