import { describe, expect, it } from "vitest";
import { engagement, mergeMetrics, refreshEvery, summarize } from "./insights";
import type { Post } from "./types";

const H = 3600_000;

describe("insights", () => {
  it("refreshes new posts often, older ones less, and stops after 90 days", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    expect(refreshEvery(new Date(now - 5 * H).toISOString(), now)).toBe(H);
    expect(refreshEvery(new Date(now - 5 * 24 * H).toISOString(), now)).toBe(6 * H);
    expect(refreshEvery(new Date(now - 30 * 24 * H).toISOString(), now)).toBe(24 * H);
    expect(refreshEvery(new Date(now - 91 * 24 * H).toISOString(), now)).toBeNull();
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
