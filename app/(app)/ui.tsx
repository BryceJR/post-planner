import { PLATFORM_INFO, type Platform } from "@/lib/platforms";
import type { PostStatus, TargetStatus } from "@/lib/types";

// The small pieces the pages share.

const NETWORK_MARK: Record<Platform, { text: string; className: string }> = {
  x: { text: "X", className: "bg-black text-white" },
  facebook: { text: "f", className: "bg-[#1877f2] text-white" },
  instagram: { text: "IG", className: "bg-[#d62976] text-white" },
  linkedin: { text: "in", className: "bg-[#0a66c2] text-white" },
  youtube: { text: "▶", className: "bg-[#ff0033] text-white" },
  tiktok: { text: "TT", className: "bg-[#111111] text-[#25f4ee]" },
  reddit: { text: "r/", className: "bg-[#ff4500] text-white" },
  bluesky: { text: "bs", className: "bg-[#1185fe] text-white" },
};

export function NetworkMark({ platform, size = "sm" }: { platform: Platform; size?: "sm" | "md" }) {
  const mark = NETWORK_MARK[platform];
  const box = size === "md" ? "h-8 w-8 text-sm" : "h-5 w-5 text-[10px]";
  return (
    <span title={PLATFORM_INFO[platform].name} aria-label={PLATFORM_INFO[platform].name} className={`inline-flex shrink-0 items-center justify-center rounded-md font-bold leading-none ${box} ${mark.className}`}>
      {mark.text}
    </span>
  );
}

export const POST_STATUS_LABEL: Record<PostStatus, string> = { draft: "Draft", scheduled: "Scheduled", publishing: "Sending", published: "Posted", failed: "Didn't go" };

export const POST_STATUS_STYLE: Record<PostStatus, string> = {
  draft: "border border-dashed border-line bg-paper text-ink-soft",
  scheduled: "bg-spruce-tint text-spruce-deep",
  publishing: "bg-sign-tint text-ink",
  published: "border border-line bg-surface text-ink",
  failed: "bg-danger-tint text-danger",
};

export function PostStatusChip({ status }: { status: PostStatus }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${POST_STATUS_STYLE[status]}`}>{POST_STATUS_LABEL[status]}</span>;
}

export const TARGET_STATUS_LABEL: Record<TargetStatus, string> = { pending: "Waiting", publishing: "Sending", processing: "Being processed", published: "Posted", failed: "Didn't go" };

// 1234 → "1.2K"
export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
