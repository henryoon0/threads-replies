// 완성된 답 칠하기 규칙 (2026-09-29 henry: "형광펜은 이전 이야기와 상충되거나 잘못된 내용이면 칠해지는 게 맞다").
//
// 칠하는 것은 두 가지뿐:
//   ① 예전 답과 다름 (consistency: 주인이 예전에 한 말과 부딪히는 문장)
//   ② 근거 없음 (fact-check: 가져온 자료가 있는데 그 자료에 없는 숫자·이름·효과)
// 관문의 "확인" 표현(처방약 이름 등)은 칠하지 않는다. 관문의 "막음"(링크 등)은 칠하지 않고 칸 아래 한 줄(notes)로만 알린다.
// 자료가 하나도 없는 초안(토글·버전 초안)은 근거 대조를 하지 않는다 — 모든 숫자가 "근거 없음"이 돼서 칠하기가 뜻을 잃는다.
// 순수 — I/O 없음.

import { withPastHits } from "./consistency-spans";
import { withFactHits, type unsupportedSpans } from "./fact-check";
import type { AnswerSource, ConsistencyHit, GateResult } from "./model";

export interface PaintInput {
  text: string;
  /** 관문 검사 결과 (checkGate) */
  gate: GateResult;
  /** 근거 없는 사실 문장 (unsupportedSpans). 자료가 없으면 무시한다. */
  facts: ReturnType<typeof unsupportedSpans>;
  sources: readonly AnswerSource[];
  past: readonly ConsistencyHit[] | undefined;
  strict: boolean;
}

/** 칠할 구간(근거 없음·예전 답과 다름)과 칸 아래 알림(관문 막음)을 만든다. */
export function editorPaint(p: PaintInput): GateResult {
  const notes = p.gate.hits.filter((h) => h.action === "block");
  const facts = p.sources.length ? p.facts : [];
  const withFacts = withFactHits({ status: "pass", hits: [] }, facts, p.strict);
  const painted = withPastHits(withFacts, p.past, p.text);
  const blocked = notes.length > 0 || painted.hits.some((h) => h.action === "block");
  const status = blocked ? "block" : painted.hits.length ? "check" : "pass";
  return { status, hits: painted.hits, ...(notes.length ? { notes } : {}) };
}

/** 관문 결과에서 칠하기만 뺀 모양 (자료·예전 답이 없는 칸: 일괄 작업 칸) */
export function notesOnly(gate: GateResult): GateResult {
  return editorPaint({ text: "", gate, facts: [], sources: [], past: [], strict: false });
}
