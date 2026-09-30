// 토글 초안 — 켠 조각(공감·드립·원리·성분·제품)만 든 답 하나 (2026-09-29 박약사 운영자 "쉽게 쓰는 도구").
//
// 모델은 조각별 글을 JSON 으로 돌려주고, 이어 붙이기와 위치 계산은 코드가 한다.
// 그래서 화면은 sections 의 [start, end) 로 조각을 칠하고, 토글을 끄면 그 조각만 빠진 글이 온다.
// 순수 — I/O 없음 (compose-run.ts 가 원장·세션·모델 호출을 맡는다).

import { COMPOSE_KINDS, PRODUCT_CHANNELS, stripMarkers, type ComposeKind, type ProductChannel } from "./compose-kinds";
import type { DraftOption, ReplyAnswer } from "./model";

// ── 토글 ────────────────────────────────────────────────────────────

export interface ComposeToggles {
  empathy?: boolean;
  joke?: boolean;
  principle?: boolean;
  ingredient?: boolean;
  product?: boolean | { pharmacy?: boolean; online?: boolean; overseas?: boolean };
}

export interface ToggleSet {
  kinds: ComposeKind[];
  channels: ProductChannel[];
}

/** 요청 본문의 toggles → 켠 종류(정해진 순서) + 제품 경로. product:true 는 약국. 하나도 없으면 오류 문자열. */
export function parseToggles(raw: unknown): ToggleSet | string {
  if (!raw || typeof raw !== "object") return "toggles 가 필요해요";
  const t = raw as Record<string, unknown>;
  const channels = productChannels(t.product);
  const kinds = COMPOSE_KINDS.filter((k) => (k === "product" ? channels.length > 0 : t[k] === true));
  if (!kinds.length) return "켠 토글이 하나도 없어요";
  return { kinds, channels };
}

function productChannels(v: unknown): ProductChannel[] {
  if (v === true) return ["pharmacy"];
  if (!v || typeof v !== "object") return [];
  const o = v as Record<string, unknown>;
  return PRODUCT_CHANNELS.filter((c) => o[c] === true);
}

/** ToggleSet → 요청 본문 모양 (GET 기본 토글 응답) */
export function toToggles(set: ToggleSet): ComposeToggles {
  const out: ComposeToggles = {};
  for (const k of set.kinds) {
    if (k === "product") out.product = Object.fromEntries(set.channels.map((c) => [c, true]));
    else out[k] = true;
  }
  return out;
}

// ── 조각 검증·조립 ──────────────────────────────────────────────────

export interface ComposeSection {
  kind: ComposeKind;
  start: number;
  end: number;
}

export interface ComposedDraft {
  draft: string;
  sections: ComposeSection[];
}

export interface RawSection {
  kind: ComposeKind;
  text: string;
}

/**
 * 모델 JSON({sections:[{kind,text}]})을 켠 종류와 맞춘다. 같은 종류가 둘이면 이어 붙이고,
 * 켜지 않은 종류는 버린다. 켠 종류가 빠졌으면 missing 에 남긴다. 기호(말줄임·웃음)는 여기서 지운다.
 */
export function readSections(raw: unknown, kinds: readonly ComposeKind[]): { sections: RawSection[]; missing: ComposeKind[]; extra: string[] } {
  const list = Array.isArray((raw as { sections?: unknown } | null)?.sections) ? ((raw as { sections: unknown[] }).sections) : [];
  const out: RawSection[] = [];
  const extra: string[] = [];
  for (const item of list) {
    const o = (item ?? {}) as Record<string, unknown>;
    const kind = String(o.kind ?? "").trim() as ComposeKind;
    const text = stripMarkers(String(o.text ?? ""));
    if (!text) continue;
    if (!kinds.includes(kind)) {
      extra.push(kind);
      continue;
    }
    const same = out.find((s) => s.kind === kind);
    if (same) same.text = `${same.text} ${text}`;
    else out.push({ kind, text });
  }
  return { sections: out, missing: kinds.filter((k) => !out.some((s) => s.kind === k)), extra };
}

export interface AskBack {
  /** 이 댓글로 판단할 정보가 충분한가 (false 면 되묻는다) */
  enough: boolean;
  ask: string;
}

/** 모델 JSON 의 enough·ask. enough=false 인데 질문이 비었으면 충분한 것으로 본다. */
export function readAskBack(raw: unknown): AskBack {
  const o = (raw ?? {}) as Record<string, unknown>;
  const ask = stripMarkers(String(o.ask ?? "")).trim();
  return o.enough === false && ask ? { enough: false, ask } : { enough: true, ask: "" };
}

/** 되묻기를 조각 글 끝에 붙인다. 조각이 없으면(질문만) 켠 첫 종류의 조각으로 싣는다. */
export function attachAsk(sections: readonly RawSection[], ask: string, kinds: readonly ComposeKind[]): RawSection[] {
  if (!ask) return [...sections];
  if (!sections.length) return kinds.length ? [{ kind: kinds[0], text: ask }] : [];
  const last = sections[sections.length - 1];
  return [...sections.slice(0, -1), { ...last, text: `${last.text} ${ask}` }];
}

const SHORT_JOIN_CHARS = 90;

/** 조각을 이어 붙이고 위치를 잰다. 짧은 답(합 90자 이하)은 한 줄로, 아니면 빈 줄로 문단을 나눈다. */
export function assembleSections(sections: readonly RawSection[]): ComposedDraft {
  const total = sections.reduce((n, s) => n + s.text.length, 0);
  const sep = total <= SHORT_JOIN_CHARS ? " " : "\n\n";
  let draft = "";
  const out: ComposeSection[] = [];
  sections.forEach((s, i) => {
    if (i > 0) draft += sep;
    const start = draft.length;
    draft += s.text;
    out.push({ kind: s.kind, start, end: draft.length });
  });
  return { draft, sections: out };
}

/** 조립된 글에서 조각 글을 다시 꺼낸다 (위치가 글과 안 맞으면 null). */
export function sectionTexts(composed: ComposedDraft): RawSection[] | null {
  const out: RawSection[] = [];
  for (const s of composed.sections) {
    if (s.start < 0 || s.end > composed.draft.length || s.start >= s.end) return null;
    out.push({ kind: s.kind, text: composed.draft.slice(s.start, s.end) });
  }
  return out;
}

/** 모델 없이 조각만 빼기 (다시 쓰기가 실패했을 때의 바닥). 남는 조각이 없으면 null. */
export function removeSections(composed: ComposedDraft, kinds: readonly ComposeKind[]): ComposedDraft | null {
  const texts = sectionTexts(composed);
  if (!texts) return null;
  const kept = texts.filter((s) => kinds.includes(s.kind));
  return kept.length ? assembleSections(kept) : null;
}

/** 이번 요청이 앞 초안에서 조각을 빼기만 하는가 (넣는 조각이 없고, 앞 초안 조각을 알 때) */
export function isRemovalOnly(prev: readonly ComposeKind[], next: readonly ComposeKind[]): boolean {
  return prev.length > next.length && next.every((k) => prev.includes(k));
}

// ── 원장에 넣기 ─────────────────────────────────────────────────────

export const COMPOSE_CATEGORY_ID = "compose";

export interface ComposeState {
  toggles: ComposeToggles;
  sections: ComposeSection[];
  sessionId?: string;
  at: string;
}

export type ComposedAnswer = ReplyAnswer & { compose?: ComposeState };

function composeOption(composed: ComposedDraft, set: ToggleSet): DraftOption {
  const name = set.kinds.length === 1 ? "토글 초안" : `토글 초안 (${set.kinds.length}조각)`;
  return { categoryId: COMPOSE_CATEGORY_ID, categoryName: name, draft: composed.draft, sentences: [{ text: composed.draft, sourceIds: [] }] };
}

export interface ComposeMeta {
  model: string;
  now: string;
  sessionId?: string;
}

function freshAnswer(composed: ComposedDraft, meta: ComposeMeta): ReplyAnswer {
  return {
    verdict: "unknown",
    verdictReason: "토글 초안 (근거 확인 없음)",
    sources: [],
    sentences: [{ text: composed.draft, sourceIds: [] }],
    draft: composed.draft,
    model: meta.model,
    generatedAt: meta.now,
    styleExamples: 0,
  };
}

/**
 * 토글 초안을 고른 벌로 넣는다: compose 벌을 바꾸거나 붙이고, chosen·draft·aiDraft 를 그 글로.
 * (aiDraft 의미 유지: 토글 초안도 AI 가 쓴 초안이다. 학습 신호 = 이 글과 보낸 답의 차이.)
 * 글이 바뀌었으니 예전 어긋남 결과(consistency)·관문 결과(gate)는 떼어 둔다 (새 글 기준으로 다시 잰다).
 */
export function withComposed(answer: ReplyAnswer | undefined, composed: ComposedDraft, set: ToggleSet, meta: ComposeMeta): ComposedAnswer {
  const base = answer ?? freshAnswer(composed, meta);
  const { consistency: _c, consistencyFor: _f, dropped: _d, gate: _g, ...rest } = base;
  void [_c, _f, _d, _g];
  const option = composeOption(composed, set);
  const options = [...(base.options ?? [])];
  const at = options.findIndex((o) => o.categoryId === COMPOSE_CATEGORY_ID);
  const chosen = at >= 0 ? at : options.length;
  options[chosen] = option;
  const sessionId = meta.sessionId ?? base.sessionId;
  return {
    ...rest,
    options,
    chosen,
    draft: composed.draft,
    aiDraft: composed.draft,
    sentences: option.sentences,
    ...(sessionId ? { sessionId } : {}),
    compose: { toggles: toToggles(set), sections: composed.sections, ...(sessionId ? { sessionId } : {}), at: meta.now },
  };
}

/** 원장 답에 남은 앞 토글 초안 (글이 주인 손으로 바뀌었으면 조각 위치를 믿지 않는다) */
export function previousComposed(answer: ComposedAnswer | undefined): { composed: ComposedDraft; kinds: ComposeKind[] } | null {
  const c = answer?.compose;
  const opt = answer?.options?.find((o) => o.categoryId === COMPOSE_CATEGORY_ID);
  if (!c || !opt) return null;
  const composed = { draft: opt.draft, sections: c.sections };
  if (!sectionTexts(composed)) return null;
  return { composed, kinds: c.sections.map((s) => s.kind) };
}
