// 숫자 줄 (픽 18) — 학습 기록(private/reply-log.jsonl)에서 이번 주와 지난주를 센다.
// 기록의 모양·쓰기는 reply-log.ts 가 정본이다. 여기는 센다.
// Pure — I/O 없음.

import { localDateKey, shiftLocalDateKey } from "@/lib/date";
import type { ReplyLogEntry } from "./reply-log";

export type { ReplyLogEntry };

// ── 주 단위 ────────────────────────────────────────────

/** 월요일 시작 로컬 주의 첫날 키 */
export function weekStartKey(date: Date): string {
  const offset = (date.getDay() + 6) % 7; // 월=0 … 일=6
  return shiftLocalDateKey(localDateKey(date), -offset);
}

export interface WeekNumbers {
  /** 이 주의 월요일 (YYYY-MM-DD) */
  weekStart: string;
  sent: number;
  /** 그대로 보낸 비율 (editRatio === 0) — 보낸 게 없으면 null */
  asIsRatio: number | null;
  /** 평균 수정 비율 — 계산할 게 없으면 null */
  avgEditRatio: number | null;
  gateBlocks: number;
  /** 학습에서 뺀 기록 (learn:false) */
  excluded: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function weekNumbers(entries: readonly ReplyLogEntry[], weekStart: string): WeekNumbers {
  const inWeek = entries.filter((e) => {
    const t = new Date(e.at);
    return !Number.isNaN(t.getTime()) && weekStartKey(t) === weekStart;
  });
  const sent = inWeek.filter((e) => e.action === "sent" || e.action === "sent_edited");
  const ratios = sent.map((e) => e.editRatio).filter((r): r is number => r !== null);
  return {
    weekStart,
    sent: sent.length,
    asIsRatio: sent.length ? round3(sent.filter((e) => e.editRatio === 0).length / sent.length) : null,
    avgEditRatio: ratios.length ? round3(ratios.reduce((s, r) => s + r, 0) / ratios.length) : null,
    gateBlocks: inWeek.filter((e) => e.action === "gate_blocked").length,
    excluded: inWeek.filter((e) => !e.learn).length,
  };
}

export interface LearningStats {
  thisWeek: WeekNumbers;
  lastWeek: WeekNumbers;
  /** 과거 답 다시 돌리기로 채운 학습 재료 (보낸 수에는 안 셈) */
  replayed: number;
  /** 학습 재료로 쓸 수 있는 기록 (learn · 초안 · 보낸 답 모두 있음) */
  learnable: number;
  rulebook: { tokens: number; budget: number; ratio: number };
}

export const isReplay = (e: ReplyLogEntry): boolean => e.reason === "replay";

/** 학습 재료: 학습 허용 + AI 초안과 보낸 답이 둘 다 있는 보낸 기록 */
export function isLearnable(e: ReplyLogEntry): boolean {
  return e.learn && Boolean(e.aiDraft?.trim()) && Boolean(e.final?.trim()) && (e.action === "sent" || e.action === "sent_edited");
}

/** 규칙책 크기 — backpass 와 같은 셈(UTF-8 바이트 ÷ 4, 올림). */
export function estimateTokens(text: string): number {
  return text ? Math.ceil(Buffer.byteLength(text, "utf8") / 4) : 0;
}

export function learningStats(
  entries: readonly ReplyLogEntry[],
  rulebookText: string,
  budget: number,
  now: Date = new Date()
): LearningStats {
  const real = entries.filter((e) => !isReplay(e));
  const thisStart = weekStartKey(now);
  const tokens = estimateTokens(rulebookText);
  return {
    thisWeek: weekNumbers(real, thisStart),
    lastWeek: weekNumbers(real, shiftLocalDateKey(thisStart, -7)),
    replayed: entries.filter(isReplay).length,
    learnable: entries.filter(isLearnable).length,
    rulebook: { tokens, budget, ratio: budget > 0 ? round3(tokens / budget) : 0 },
  };
}
