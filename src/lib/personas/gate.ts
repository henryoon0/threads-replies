// 안전 관문 — 보낼 답에서 위험한 표현을 찾아 글자 위치로 돌려준다 (시안 픽 7·11).
// 빨간 배지 대신 화면이 그 구간을 칠하고 호버로 이유를 보여주므로 위치가 정확해야 한다.
// 위치는 JS 문자열 인덱스 [start, end) — 화면이 text.slice(start, end) 로 그대로 자른다.
// 규칙은 팩의 gate-rules.json (읽기는 gate-rules.ts). 안전 규칙이라 학습(backpass) 대상이 아니다.
// Pure — I/O 없음, Node import 없음 (클라이언트 컴포넌트도 import 한다).
import type { GateHit, GateResult } from "@/lib/threads-replies/model";

export type GateAction = GateHit["action"];
export type GateStatus = GateResult["status"];

export interface GateRule {
  id: string;
  /** 화면 묶음 이름 (drug-choice · brand · purchase · link · price …) */
  kind: string;
  /** block = strict 팩에서 고치기 전엔 못 보냄, check = 칠하고 확인만 */
  action: GateAction;
  /** JS 정규식 원문. 플래그는 늘 GATE_FLAGS. */
  pattern: string;
  reason: string;
  /** 그 구간을 바꿔 쓸 표현 (있을 때만) */
  suggest?: string;
}

export interface GateRules {
  version: 1;
  rules: GateRule[];
}

export const GATE_FLAGS = "giu";
export const EMPTY_GATE_RULES: GateRules = { version: 1, rules: [] };

// 같은 원문은 한 번만 컴파일한다. matchAll 은 정규식을 복제해 쓰므로 공유해도 lastIndex 가 새지 않는다.
const compiled = new Map<string, RegExp | null>();

/** 규칙 원문 → 정규식. 깨진 원문이면 null (그 규칙만 건너뛴다). */
export function compileGatePattern(pattern: string): RegExp | null {
  if (compiled.has(pattern)) return compiled.get(pattern) ?? null;
  let re: RegExp | null = null;
  try {
    re = new RegExp(pattern, GATE_FLAGS);
  } catch {
    re = null;
  }
  compiled.set(pattern, re);
  return re;
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function toRule(raw: unknown): GateRule | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (![r.id, r.kind, r.pattern, r.reason].every(isStr)) return null;
  if (r.action !== "block" && r.action !== "check") return null;
  if (!compileGatePattern(r.pattern as string)) return null;
  const rule: GateRule = { id: r.id as string, kind: r.kind as string, action: r.action, pattern: r.pattern as string, reason: r.reason as string };
  if (typeof r.suggest === "string") rule.suggest = r.suggest;
  return rule;
}

/** gate-rules.json(임의 JSON) → 규칙. 모양이 틀린 규칙·깨진 정규식은 버린다. 모양 자체가 틀리면 null. */
export function parseGateRules(raw: unknown): GateRules | null {
  if (typeof raw !== "object" || raw === null) return null;
  const list = (raw as { rules?: unknown }).rules;
  if (!Array.isArray(list)) return null;
  return { version: 1, rules: list.map(toRule).filter((r): r is GateRule => r !== null) };
}

/** 후보 한 건 + 그 규칙이 파일에서 몇 번째인지 (겹칠 때 우선순위) */
interface Candidate {
  hit: GateHit;
  order: number;
}

function hitOf(rule: GateRule, m: RegExpExecArray | RegExpMatchArray): GateHit {
  const start = m.index ?? 0;
  const hit: GateHit = { start, end: start + m[0].length, phrase: m[0], kind: rule.kind, action: rule.action, reason: rule.reason };
  if (rule.suggest !== undefined) hit.suggest = rule.suggest;
  return hit;
}

function candidatesOf(text: string, rules: GateRules): Candidate[] {
  const out: Candidate[] = [];
  rules.rules.forEach((rule, order) => {
    const re = compileGatePattern(rule.pattern);
    if (!re) return;
    for (const m of text.matchAll(re)) {
      if (m[0]) out.push({ hit: hitOf(rule, m), order }); // 빈 매치는 칠할 게 없다
    }
  });
  return out;
}

const actionRank = (h: GateHit) => (h.action === "block" ? 0 : 1);
const spanLength = (h: GateHit) => h.end - h.start;

// 겹치면 block 이 check 를 이기고, 그다음은 파일에서 먼저 적힌 규칙, 앞선 위치, 긴 구간 순.
function byPriority(a: Candidate, b: Candidate): number {
  return actionRank(a.hit) - actionRank(b.hit) || a.order - b.order || a.hit.start - b.hit.start || spanLength(b.hit) - spanLength(a.hit);
}

function overlaps(a: GateHit, b: GateHit): boolean {
  return a.start < b.end && b.start < a.end;
}

function pickNonOverlapping(candidates: Candidate[]): GateHit[] {
  const kept: GateHit[] = [];
  for (const { hit } of [...candidates].sort(byPriority)) {
    if (!kept.some((k) => overlaps(k, hit))) kept.push(hit);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export function gateStatusOf(hits: readonly GateHit[]): GateStatus {
  if (hits.some((h) => h.action === "block")) return "block";
  return hits.length > 0 ? "check" : "pass";
}

/** 보낼 답을 검사한다. 구간은 겹치지 않고 앞에서부터 정렬돼 있다. */
export function checkGate(text: string, rules: GateRules): GateResult {
  const hits = pickNonOverlapping(candidatesOf(text, rules));
  return { status: gateStatusOf(hits), hits };
}

/** light 팩은 확인만 한다 — block 규칙이 있어도 check 로 낮춘다. strict 는 그대로. */
export function applyGateMode(result: GateResult, mode: "light" | "strict"): GateResult {
  if (mode === "strict") return result;
  const hits = result.hits.map((h) => (h.action === "block" ? { ...h, action: "check" as const } : h));
  return { status: gateStatusOf(hits), hits };
}

/**
 * 남이 단 댓글 검사. 댓글은 내가 고칠 글이 아니라서 막지 않고 전부 check 로 돌려준다
 * ("이 댓글은 처방약 선택을 묻는다" 같은 안내용).
 */
export function checkCommentGate(text: string, rules: GateRules): GateResult {
  return applyGateMode(checkGate(text, rules), "light");
}
