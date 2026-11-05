import { describe, expect, it } from "vitest";
import { engagement, mergeMetrics, nextMetricsAt, summarize } from "./insights";
import type { Post } from "./types";

const H = 3600_000;

describe("insights", () => {
  it("reads new posts often, older ones less, and stops after 90 days", () => {
    const sent = "2026-11-03T12:00:00.000Z";
    const at = (h: number) => Date.parse(sent) + h * H;
    const iso = (h: number) => new Date(at(h)).toISOString();
    expect(nextMetricsAt("facebook", sent, null)).toBe(iso(1));
    expect(nextMetricsAt("facebook", sent, at(5))).toBe(iso(6));
    expect(nextMetricsAt("instagram", sent, at(5 * 24))).toBe(iso(5 * 24 + 6));
    expect(nextMetricsAt("tiktok", sent, at(30 * 24))).toBe(iso(31 * 24));
    expect(nextMetricsAt("youtube", sent, at(89.5 * 24))).toBeNull();
    expect(nextMetricsAt("youtube", "not a date", null)).toBeNull();
  });
  it("reads an X post four times, since X charges for each read", () => {
    const sent = "2026-11-03T12:00:00.000Z";
    const at = (h: number) => Date.parse(sent) + h * H;
    const iso = (h: number) => new Date(at(h)).toISOString();
    const reads: string[] = [];
    let next = nextMetricsAt("x", sent, null);
    while (next && reads.length < 10) {
      reads.push(next);
      next = nextMetricsAt("x", sent, Date.parse(next) + 60_000); // read a minute late
    }
    expect(reads).toEqual([iso(1), iso(24), iso(7 * 24), iso(30 * 24)]);
    // a run that was down for days reads once, not once per missed time
    expect(nextMetricsAt("x", sent, at(10 * 24))).toBe(iso(30 * 24));
  });
  it("keeps numbers a network didn't say this time", () => {
    expect(mergeMetrics({ views: 10, likes: 2 }, { likes: 5, views: null })).toEqual({ views: 10, likes: 5 });
  });
  it("engagement is what people did", () => {
    expect(engagement({ views: 100, likes: 3, comments: 2, shares: 1, saves: 1 })).toBe(7);
  });
  it("adds posts up by network and by day, and ranks the best", () => {
    const target = (id: string, account: string, day: string, metrics: Record<string, number>, status = "published") => ({
      id, account_id: account, body: null, settings: {}, status, progress: {}, check_at: null, external_id: "e", external_url: null, error: null, attempted_at: null,
      published_at: status === "published" ? `${day}T18:00:00.000Z` : null, metrics, metrics_at: null,
    });
    const posts = [
      { id: "p1", body: "One", targets: [target("t1", "a1", "2026-11-01", { views: 100, likes: 5 }), target("t2", "a2", "2026-11-01", { views: 50, comments: 9 })] },
      { id: "p2", body: "Two", targets: [target("t3", "a1", "2026-11-02", { views: 10, likes: 1 }), target("t4", "a2", "2026-11-02", {}, "failed")] },
    ] as unknown as Post[];
    const accounts = new Map([["a1", { platform: "x" as const }], ["a2", { platform: "youtube" as const }]]);
    const s = summarize(posts, accounts, ["2026-11-01", "2026-11-02", "2026-11-03"], "America/Los_Angeles");
    expect(s.total.posts).toBe(3);
    expect(s.total.views).toBe(160);
    expect(s.byPlatform.x).toMatchObject({ posts: 2, views: 110, likes: 6 });
    expect(s.byPlatform.youtube).toMatchObject({ posts: 1, views: 50, comments: 9 });
    expect(s.byDay).toEqual([
      { day: "2026-11-01", views: 150, engagement: 14, posts: 2 },
      { day: "2026-11-02", views: 10, engagement: 1, posts: 1 },
      { day: "2026-11-03", views: 0, engagement: 0, posts: 0 },
    ]);
    expect(s.top.map((t) => t.targetId)).toEqual(["t2", "t1", "t3"]);
  });
});
