"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// A link or key to copy, with a button that says when it's done.
export function CopyText({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this:", text);
    }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <code className="min-w-0 max-w-full break-all rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs">{text}</code>
      <Button type="button" variant="secondary" size="sm" onClick={copy}>
        {copied ? "Copied" : label}
      </Button>
    </div>
  );
}
