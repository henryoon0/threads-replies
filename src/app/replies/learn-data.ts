"use client";

// 학습 화면 4개가 같이 쓰는 데이터 도구: 불러오기 훅, POST 도우미, 화면 계산(순수 함수).
// 서버 모양은 src/lib/personas/learning/* 와 src/app/api/personas/{learning,voice} 가 정본이다.

import { useCallback, useEffect, useRef, useState } from "react";
import type { LearningOverview, LearningJob } from "@/lib/personas/learning/job";
import type { ReviewCard, PatternExample } from "@/lib/personas/learning/patterns";
import type { RuleRow } from "@/lib/personas/learning/rules";
import type { ExclusionDecision, ExclusionReason } from "@/lib/personas/voice-exclusions";

export type { LearningOverview, LearningJob, ReviewCard, PatternExample, RuleRow, ExclusionDecision, ExclusionReason };

export interface VoiceCandidate {
  id: string;
  comment: string;
  reply: string;
  reasons: ExclusionReason[];
  decision: ExclusionDecision;
  locked: boolean;
  decidedBy: "default" | "owner";
}

export interface VoiceData {
  candidates: VoiceCandidate[];
  stats: { total: number; flagged: number; excluded: number; kept: number; masked: number };
}

// ── 불러오기 ─────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<{ data: T } | { error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = (await res.json()) as T & { error?: string };
    if (!res.ok) return { error: body.error ?? `불러오지 못했어요 (${res.status})` };
    return { data: body };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function useLearnJson<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const apply = useCallback((r: { data: T } | { error: string }) => {
    if (!alive.current) return;
    if ("data" in r) {
      setData(r.data);
      setError(null);
    } else setError(r.error);
  }, []);

  const reload = useCallback(() => fetchJson<T>(url).then(apply), [url, apply]);

  useEffect(() => {
    alive.current = true;
    fetchJson<T>(url).then(apply);
    return () => {
      alive.current = false;
    };
  }, [url, apply]);

  return { data, setData, error, reload };
}

export interface PostResult<T> {
  ok: boolean;
  status: number;
  body: T & { error?: string; reason?: string };
}

export async function postJson<T = Record<string, unknown>>(url: string, payload: unknown): Promise<PostResult<T>> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = (await res.json().catch(() => ({}))) as PostResult<T>["body"];
  return { ok: res.ok, status: res.status, body };
}

/** 실패 응답에서 사람이 읽을 이유 한 줄 */
export function failReason(r: PostResult<unknown>): string {
  return r.body.reason ?? r.body.error ?? `처리하지 못했어요 (${r.status})`;
}

// ── 주간 검토 ─────────────────────────────────────────────────────

export const isLockedCard = (c: ReviewCard) => c.status === "locked" || c.safety.locked;
export const isDecided = (c: ReviewCard) => c.status === "applied" || c.status === "rejected";

/** 판결 대기 카드: 제안 먼저, 그다음 패턴. 잠긴 카드는 맨 뒤 (읽고 넘기기만). */
export function pendingDeck(cards: readonly ReviewCard[], skipped: ReadonlySet<string>): ReviewCard[] {
  const open = cards.filter((c) => !isDecided(c) && !skipped.has(c.id));
  const rank = (c: ReviewCard) => (isLockedCard(c) ? 2 : c.type === "proposal" ? 0 : 1);
  return open.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
}

/** 카드 제목: 쉬운 제목 > 첫 패턴 제목 > 영문 제목 */
export function cardTitle(c: ReviewCard): string {
  return c.proposal?.plainTitle || c.patterns[0]?.title || c.proposal?.title || "제목 없는 카드";
}

/** 보여 줄 실제 기록 3개: 패턴 예시 먼저, 모자라면 근거 대화에서 채운다. 같은 답은 한 번만. */
export function cardTriplets(c: ReviewCard, max = 3): PatternExample[] {
  const out: PatternExample[] = [];
  const seen = new Set<string>();
  const push = (t: PatternExample | null | undefined) => {
    if (!t || out.length >= max) return;
    const key = `${t.comment}\u0000${t.final}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  c.patterns.forEach((p) => p.examples.forEach(push));
  c.evidence.forEach((e) => push(e.triplet));
  return out;
}

/** 규칙책 변경 줄: 제안은 찾기→바꾸기, 패턴 카드는 더해질 규칙 한 줄 */
export function changeLines(c: ReviewCard): { before: string | null; after: string }[] {
  const hunks = (c.proposal?.hunks ?? []).map((h) => ({ before: h.find as string | null, after: h.replace }));
  const implied = c.type === "pattern" ? c.patterns[0]?.impliedRule : "";
  return implied ? [...hunks, { before: null, after: implied }] : hunks;
}

const PHASE_LABEL: Record<string, string> = {
  config: "준비하는 중",
  backpass: "보낸 답과 초안을 비교하는 중",
  patterns: "고친 패턴을 찾는 중",
  done: "끝났어요",
};

export function jobPhaseLabel(job: Pick<LearningJob, "phase">): string {
  return PHASE_LABEL[job.phase] ?? "분석하는 중";
}

/** 몇 분 전 / 몇 시간 전 / 며칠 전 */
export function agoLabel(iso: string | null, now: number): string {
  if (!iso) return "아직 안 돌렸어요";
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}시간 전` : `${Math.round(h / 24)}일 전`;
}

export function elapsedLabel(fromIso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(fromIso).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ── 규칙 정리 ─────────────────────────────────────────────────────

export type HeatTone = "positive" | "negative" | "mixed" | "idle";

export interface Heat {
  tone: HeatTone;
  /** 0~1, 색 진하기 */
  strength: number;
  /** 최근 분석한 대화에서 한 번도 안 쓰인 규칙 — 지우기 후보 */
  faint: boolean;
}

export function heatOf(r: Pick<RuleRow, "positive" | "negative" | "relevance" | "sessions">): Heat {
  const hits = r.positive + r.negative;
  const tone: HeatTone = hits === 0 ? "idle" : r.positive && r.negative ? "mixed" : r.positive ? "positive" : "negative";
  const strength = Math.min(1, Math.max(r.relevance, hits / 6));
  return { tone, strength, faint: hits === 0 && r.sessions === 0 };
}

export interface RuleSection {
  title: string;
  rules: RuleRow[];
}

/** 이어진 같은 절끼리 묶는다. 제목은 경로 "a > b" 의 마지막 칸. */
export function groupBySection(rules: readonly RuleRow[]): RuleSection[] {
  const out: RuleSection[] = [];
  for (const r of rules) {
    const title = r.section.split(">").pop()?.trim() || "규칙";
    const last = out[out.length - 1];
    if (last && last.title === title) last.rules.push(r);
    else out.push({ title, rules: [r] });
  }
  return out;
}

// ── 말투 재료 ─────────────────────────────────────────────────────

export interface Segment {
  text: string;
  reason: ExclusionReason | null;
}

/** 답글을 이유 문구 자리에서 잘라 칠할 조각으로 만든다. 겹치면 먼저 나온 것만. */
export function phraseSegments(text: string, reasons: readonly ExclusionReason[]): Segment[] {
  const hits: { start: number; end: number; reason: ExclusionReason }[] = [];
  for (const reason of reasons) {
    if (!reason.phrase) continue;
    const start = text.indexOf(reason.phrase);
    if (start < 0) continue;
    const end = start + reason.phrase.length;
    if (hits.some((h) => start < h.end && end > h.start)) continue;
    hits.push({ start, end, reason });
  }
  hits.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start > at) out.push({ text: text.slice(at, h.start), reason: null });
    out.push({ text: text.slice(h.start, h.end), reason: h.reason });
    at = h.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), reason: null });
  return out;
}

/** 결정 하나를 바꾼 뒤의 합계 (서버 재조회 없이 화면만 맞춘다) */
export function restat(stats: VoiceData["stats"], candidates: readonly VoiceCandidate[]): VoiceData["stats"] {
  const count = (d: ExclusionDecision) => candidates.filter((c) => c.decision === d).length;
  return { ...stats, excluded: count("exclude"), kept: count("keep"), masked: count("mask") };
}

/** 말투 재료로 남는 답 수 (제외만 빠진다. 가리기는 문구만 가리고 남는다) */
export const remainingMaterial = (s: VoiceData["stats"]) => s.total - s.excluded;

// ── 성과 ─────────────────────────────────────────────────────────

export const pct = (ratio: number | null) => (ratio === null ? null : Math.round(ratio * 100));
