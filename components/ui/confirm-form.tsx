"use client";

import type { ReactNode } from "react";

// A form that asks "are you sure?" before running its server action.
export function ConfirmForm({
  action,
  message,
  className = "",
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  message: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </form>
  );
}
