// 초안 3벌 길이 나누기 (09-29 henry: "긴 버전도 있어야 하고 짧은 버전도 있어야 한다").
//
// 목표 길이는 주인이 이 상황(질문·감사·대화 …)에 실제로 단 답의 길이 분포에서 잰다:
//   짧게 ≈ 하위 25%(p25) 이하, 중간 ≈ 중앙값, 길게 ≈ 상위 10%(p90).
// 세 카테고리 가운데 실측 중앙 길이가 가장 짧은 것에 "짧게", 가장 긴 것에 "길게"를 맡긴다
// (그 유형의 실제 예시가 이미 그 길이 쪽이라 말투를 억지로 늘이거나 줄이지 않는다).
// Pure — I/O 없음.

import type { LengthRole } from "./model";

/** 글자 수 (앞뒤 공백 빼고, 한글·이모지 한 글자씩). personas/categories 의 charLength 와 같다 — 화면도 쓰므로 fs 없는 여기 둔다. */
export function charLength(text: string): number {
  return [...text.trim()].length;
}

export interface LengthPlan {
  /** 짧게: 이 글자 수 안팎 (p25) */
  short: number;
  /** 중간: 중앙값 */
  mid: number;
  /** 길게: 이 글자 수 안팎 (p90) */
  long: number;
  /** 잰 답 수 */
  n: number;
}

export const ROLE_LABEL: Record<LengthRole, string> = { short: "짧게", mid: "중간", long: "길게" };

/** 이보다 적으면 상황별 대신 전체 답으로 잰다 */
const MIN_SAMPLE = 15;
/** 길게 목표 상한 (스레드 답 500자 제한 아래로) */
const LONG_CAP = 420;

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

/** 답 글자 수 목록(상황별 · 전체)으로 목표 길이를 잰다. 상황별 표본이 적으면 전체로. */
export function lengthPlan(situationLengths: readonly number[], allLengths: readonly number[]): LengthPlan | null {
  const base = situationLengths.length >= MIN_SAMPLE ? situationLengths : allLengths;
  if (base.length < 5) return null;
  const s = [...base].sort((a, b) => a - b);
  const short = Math.max(6, quantile(s, 0.25));
  const long = Math.min(LONG_CAP, Math.max(short * 3, quantile(s, 0.9)));
  const mid = Math.round(Math.min(long * 0.7, Math.max(short * 1.8, quantile(s, 0.5))));
  return { short, mid, long, n: base.length };
}

/** 짧게 통과 상한: p25 의 1.4배 또는 +10자 가운데 큰 쪽 */
export function shortMax(plan: LengthPlan): number {
  return Math.max(Math.round(plan.short * 1.4), plan.short + 10);
}

/** 길게 통과 하한: p90 의 70% (짧게 상한의 2배보다는 길게) */
export function longMin(plan: LengthPlan): number {
  return Math.max(Math.round(plan.long * 0.7), shortMax(plan) * 2);
}

/** 이 길이가 역할을 지켰나. 중간은 짧게·길게 사이면 된다. */
export function fitsRole(length: number, role: LengthRole, plan: LengthPlan): boolean {
  if (role === "short") return length <= shortMax(plan);
  if (role === "long") return length >= longMin(plan);
  return length > Math.round(plan.short * 0.8) && length < longMin(plan) * 1.2;
}

/** 실제 길이로 본 역할 (다른 버전·예전 초안 칩) */
export function roleForLength(length: number, plan: LengthPlan): LengthRole {
  if (length <= shortMax(plan)) return "short";
  if (length >= longMin(plan)) return "long";
  return "mid";
}

/**
 * 세 카테고리에 역할 맡기기: 실측 중앙 길이 순으로 짧게 · 중간 · 길게.
 * 벌이 둘이면 짧게 · 길게, 하나면 중간.
 */
export function assignRoles(medians: readonly number[]): LengthRole[] {
  const order = medians.map((m, i) => ({ m, i })).sort((a, b) => a.m - b.m || a.i - b.i);
  const roles: LengthRole[] = new Array(medians.length).fill("mid");
  if (order.length >= 2) {
    roles[order[0].i] = "short";
    roles[order[order.length - 1].i] = "long";
  }
  return roles;
}

/** 프롬프트에 싣는 한 줄 (카테고리 <target> 의 길이를 이 줄이 덮는다) */
export function roleLine(role: LengthRole, plan: LengthPlan): string {
  if (role === "short") return `짧게: ${plan.short}자 안팎, 길어도 ${shortMax(plan)}자. 핵심 한 마디만 남기고 나머지는 뺀다.`;
  if (role === "long") return `길게: ${plan.long}자 안팎, 적어도 ${longMin(plan)}자. 이유·방법·예를 풀어서 주인이 길게 답할 때처럼 쓴다. 근거에 없는 사실로 늘리지 않는다.`;
  return `중간: ${plan.mid}자 안팎.`;
}

/** 역할을 못 지킨 벌 번호 (다시 쓸 벌). 앞에서부터. */
export function lengthMisses(drafts: readonly string[], roles: readonly (LengthRole | undefined)[], plan: LengthPlan): number[] {
  const out: number[] = [];
  drafts.forEach((d, i) => {
    const role = roles[i];
    if (role && role !== "mid" && !fitsRole(charLength(d), role, plan)) out.push(i);
  });
  return out;
}

/** 다시 쓴 벌이 목표에 더 가까워졌나 (못 지켜도 더 가까우면 바꾼다) */
export function closerToRole(before: string, after: string, role: LengthRole, plan: LengthPlan): boolean {
  const target = role === "short" ? plan.short : role === "long" ? plan.long : plan.mid;
  return Math.abs(charLength(after) - target) < Math.abs(charLength(before) - target);
}
