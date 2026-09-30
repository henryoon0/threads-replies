import { describe, expect, it } from "vitest";
import type { ReplyLogEntry } from "./reply-log";
import { estimateTokens, isLearnable, learningStats, weekNumbers, weekStartKey } from "./stats";

function entry(at: string, extra: Partial<ReplyLogEntry> = {}): ReplyLogEntry {
  return {
    v: 1,
    at,
    replyId: `r-${at}-${Math.random()}`,
    postId: "p",
    persona: "aicc",
    sessionId: null,
    action: "sent",
    comment: "댓글",
    aiDraft: "초안",
    final: "초안",
    categoryId: null,
    editRatio: 0,
    gate: null,
    learn: true,
    reason: null,
    outcome: "done",
    ...extra,
  };
}

// 2026-09-29 은 화요일 → 이번 주 월요일 09-28, 지난주 09-21
const NOW = new Date(2026, 8, 29, 15, 0, 0);
const THIS = (d: number, h = 12) => new Date(2026, 8, d, h).toISOString();

describe("weekStartKey", () => {
  it("월요일 시작 로컬 주", () => {
    expect(weekStartKey(new Date(2026, 8, 28, 0, 5))).toBe("2026-09-28");
    expect(weekStartKey(new Date(2026, 9, 4, 23, 59))).toBe("2026-09-28"); // 일요일
    expect(weekStartKey(new Date(2026, 8, 27, 23, 59))).toBe("2026-09-21"); // 전 주 일요일
  });
});

describe("weekNumbers", () => {
  it("보낸 수 · 그대로 보낸 비율 · 평균 수정 비율 · 관문 차단 · 학습 제외", () => {
    const entries = [
      entry(THIS(28), { action: "sent", editRatio: 0 }),
      entry(THIS(29), { action: "sent_edited", editRatio: 0.5 }),
      entry(THIS(29), { action: "sent_edited", editRatio: 0.25, learn: false }),
      entry(THIS(29), { action: "sent_edited", editRatio: null }),
      entry(THIS(29), { action: "gate_blocked", editRatio: null, learn: false }),
      entry(THIS(29), { action: "skipped", editRatio: null }),
      entry(THIS(27), { action: "sent", editRatio: 0 }), // 지난주
    ];
    expect(weekNumbers(entries, "2026-09-28")).toEqual({
      weekStart: "2026-09-28",
      sent: 4,
      asIsRatio: 0.25,
      avgEditRatio: 0.25, // (0 + 0.5 + 0.25) / 3, null 은 빼고
      gateBlocks: 1,
      excluded: 2,
    });
    expect(weekNumbers(entries, "2026-09-21")).toMatchObject({ sent: 1, asIsRatio: 1, avgEditRatio: 0 });
  });

  it("보낸 게 없으면 비율은 null", () => {
    expect(weekNumbers([], "2026-09-28")).toMatchObject({ sent: 0, asIsRatio: null, avgEditRatio: null });
  });
});

describe("learningStats", () => {
  it("다시 돌리기(replay) 기록은 보낸 수에 안 세고 따로 센다", () => {
    const entries = [
      entry(THIS(29), { reason: "replay", action: "sent_edited", editRatio: 0.8, aiDraft: "a", final: "b" }),
      entry(THIS(29), { action: "sent", editRatio: 0 }),
    ];
    const s = learningStats(entries, "x".repeat(4000), 3500, NOW);
    expect(s.thisWeek.sent).toBe(1);
    expect(s.replayed).toBe(1);
    expect(s.learnable).toBe(2);
    expect(s.rulebook).toEqual({ tokens: 1000, budget: 3500, ratio: 0.286 });
    expect(s.lastWeek.weekStart).toBe("2026-09-21");
  });

  it("학습 재료 = 학습 허용 + 초안 + 보낸 답", () => {
    expect(isLearnable(entry(THIS(29)))).toBe(true);
    expect(isLearnable(entry(THIS(29), { learn: false }))).toBe(false);
    expect(isLearnable(entry(THIS(29), { aiDraft: null }))).toBe(false);
    expect(isLearnable(entry(THIS(29), { action: "copied" }))).toBe(false);
  });

  it("토큰은 backpass 와 같은 셈 (UTF-8 바이트 ÷ 4 올림)", () => {
    expect(estimateTokens("가")).toBe(1); // 3바이트
    expect(estimateTokens("가나")).toBe(2); // 6바이트
    expect(estimateTokens("")).toBe(0);
  });
});
