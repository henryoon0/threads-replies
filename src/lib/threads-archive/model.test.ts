import { describe, expect, it } from "vitest";
import {
  EMPTY_INSIGHTS,
  engagementRateOf,
  fullTextOf,
  needsInsightRefresh,
  scoreOf,
  sortPosts,
  type ArchivedPost,
  type ThreadsInsights,
} from "./model";

function insights(patch: Partial<ThreadsInsights> = {}): ThreadsInsights {
  return { ...EMPTY_INSIGHTS, ...patch };
}

function post(patch: Partial<ArchivedPost> = {}): ArchivedPost {
  return {
    id: "1",
    permalink: "https://www.threads.com/@aicoffeechat/post/X",
    text: "본문",
    timestamp: "2026-07-01T00:00:00+0000",
    insights: insights(),
    syncedAt: "2026-07-15T00:00:00.000Z",
    ...patch,
  };
}

describe("scoreOf", () => {
  it("품이 더 드는 반응에 더 큰 무게를 준다", () => {
    expect(scoreOf(insights({ likes: 10 }))).toBe(10);
    expect(scoreOf(insights({ replies: 10 }))).toBe(20);
    expect(scoreOf(insights({ reposts: 10 }))).toBe(30);
    expect(scoreOf(insights({ quotes: 10 }))).toBe(30);
  });

  it("조회수는 점수에 넣지 않는다 (도달일 뿐)", () => {
    expect(scoreOf(insights({ views: 100_000 }))).toBe(0);
  });

  it("실제 1위 글의 점수를 재현한다", () => {
    // fetch_threads.py 가 매긴 score 6175 와 같아야 한다(점수 연속성).
    const real = insights({ likes: 3266, replies: 52, reposts: 906, quotes: 29, views: 169514 });
    expect(scoreOf(real)).toBe(6175);
  });
});

describe("engagementRateOf", () => {
  it("도달이 다른 글을 견줄 수 있게 조회수로 나눈다", () => {
    const wide = insights({ likes: 3000, views: 150_000 }); // 2%
    const narrow = insights({ likes: 300, views: 5_000 }); // 6%
    expect(engagementRateOf(narrow)).toBeGreaterThan(engagementRateOf(wide));
  });

  it("조회가 0이면 0을 준다 (Infinity 금지)", () => {
    expect(engagementRateOf(insights({ likes: 5, views: 0 }))).toBe(0);
  });
});

describe("fullTextOf", () => {
  it("칸을 순서대로 이어붙인다", () => {
    expect(fullTextOf({ text: "1번", cards: ["2번", "3번"] })).toBe("1번\n\n2번\n\n3번");
  });

  it("칸이 없으면 루트 글만", () => {
    expect(fullTextOf({ text: "1번", cards: undefined })).toBe("1번");
  });

  it("빈 칸은 버린다", () => {
    expect(fullTextOf({ text: "1번", cards: ["", "  ", "3번"] })).toBe("1번\n\n3번");
  });
});

describe("needsInsightRefresh", () => {
  const now = Date.parse("2026-07-15T00:00:00Z");

  it("처음 보는 글은 읽는다", () => {
    expect(needsInsightRefresh(null, now)).toBe(true);
  });

  it("최근 글은 숫자가 아직 자라므로 다시 읽는다", () => {
    const recent = post({ timestamp: "2026-07-14T00:00:00+0000", insightsSyncedAt: "2026-07-14T01:00:00Z" });
    expect(needsInsightRefresh(recent, now)).toBe(true);
  });

  it("2주 지난 글은 캐시를 믿는다 (레이트 리밋 절약)", () => {
    const old = post({ timestamp: "2026-05-01T00:00:00+0000", insightsSyncedAt: "2026-05-20T00:00:00Z" });
    expect(needsInsightRefresh(old, now)).toBe(false);
  });

  it("한 번도 안 읽었으면 오래된 글이라도 읽는다", () => {
    const old = post({ timestamp: "2026-05-01T00:00:00+0000", insightsSyncedAt: undefined });
    expect(needsInsightRefresh(old, now)).toBe(true);
  });
});

describe("sortPosts", () => {
  const a = post({ id: "a", timestamp: "2026-07-01T00:00:00+0000", insights: insights({ likes: 10, views: 1000 }) });
  const b = post({ id: "b", timestamp: "2026-07-10T00:00:00+0000", insights: insights({ likes: 100, views: 100_000 }) });

  it("반응 점수순", () => {
    expect(sortPosts([a, b], "score").map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("반응률순은 도달 작은 글을 끌어올린다", () => {
    expect(sortPosts([a, b], "rate").map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("최신순", () => {
    expect(sortPosts([a, b], "recent").map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("원본 배열을 건드리지 않는다", () => {
    const input = [a, b];
    sortPosts(input, "likes");
    expect(input.map((p) => p.id)).toEqual(["a", "b"]);
  });
});
