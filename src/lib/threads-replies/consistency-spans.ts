// 예전 답과 어긋남 — 순수 부분 (화면도 쓴다): 문장 위치 · 프롬프트 · 모델 답 정리 · 원문 확인 · 칠하기 합치기.
// 호출·캐시는 consistency.ts. Pure — I/O 없음.

import type { ConsistencyHit, GateHit, GateResult, PastSaid } from "./model";

export const PAST_HIT_KIND = "예전 답과 다름";

export interface SentenceSpan {
  start: number;
  end: number;
  text: string;
}

const PAST_CHARS = 400;
const MIN_QUOTE = 4;

// ── 순수 부분 ─────────────────────────────────────────────

/** 글을 문장 위치로 자른다: 마침표·물음표·느낌표·물결·줄임표·줄바꿈 뒤. 앞뒤 공백은 뺀다. */
export function sentenceSpans(text: string): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  const re = /[^\n.!?~…]+(?:[.!?~…]+|\n|$)/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (!/[\p{L}\p{N}]/u.test(body)) continue;
    const start = (m.index ?? 0) + lead;
    out.push({ start, end: start + body.length, text: body });
  }
  return out;
}

function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** 모델이 낸 구절이 예전 답 원문에 그대로 있나 (공백·줄바꿈 차이, 앞뒤 따옴표·말줄임은 봐준다). */
export function isVerbatim(quote: string, pastText: string): boolean {
  const q = squash(quote).replace(/^["'“”‘’…]+|["'“”‘’…]+$/g, "").trim();
  if (Array.from(q).length < MIN_QUOTE) return false;
  return squash(pastText).includes(q);
}

export interface DraftForCheck {
  /** 벌 표시 (A, B, C … / F = 완성된 답) */
  key: string;
  text: string;
}

export function buildConsistencyPrompt(ownerName: string, drafts: readonly DraftForCheck[], past: readonly PastSaid[]): string {
  const pastBlock = past
    .map((p, i) => `<past id="P${i + 1}"${p.date ? ` date="${p.date}"` : ""}>${p.comment ? `\n(댓글: ${squash(p.comment).slice(0, 160)})` : ""}\n${squash(p.text).slice(0, PAST_CHARS)}\n</past>`)
    .join("\n");
  const draftBlock = drafts
    .map((d) => sentenceSpans(d.text).map((s, i) => `${d.key}${i + 1}: ${s.text}`).join("\n"))
    .join("\n");
  return `${ownerName}이(가) 예전에 단 답(<past>)과 새 답 초안의 문장을 대조한다.

<past_replies>
${pastBlock}
</past_replies>

<draft_sentences>
${draftBlock}
</draft_sentences>

할 일: 새 문장 가운데 예전 답과 **같은 점에 대해 다른 말**을 하는 문장만 찾는다.
- 어긋남 = 같은 대상(제품·방법·수치·가능 여부·추천 여부·순서·기간)에 대해 예전 답과 반대이거나 양립할 수 없는 말. 예: 예전 "아침 공복에 드세요" ↔ 새 "저녁에 드시는 게 좋아요", 예전 "무료예요" ↔ 새 "유료예요".
- 어긋남이 아닌 것: 예전 말을 되풀이·덧붙임, 다른 주제, 말투 차이, 더 자세히 말함, 예전에 없던 새 정보.
- 확실한 것만 낸다. 애매하면 내지 않는다. 대부분은 빈 목록이 맞다.
- quote 는 그 <past> 본문에서 **글자 그대로** 옮긴 짧은 구절(8~60자)이다. 바꿔 쓰거나 요약하면 안 된다.
- note 는 무엇이 다른지 한 줄(40자 안팎, 해요체).

JSON 하나만 출력한다:
{"conflicts":[{"sentence":"A2","past":"P1","quote":"예전 답에서 그대로 옮긴 구절","note":"예전엔 아침이라고 했어요"}]}`;
}

interface RawConflict {
  sentence?: unknown;
  past?: unknown;
  quote?: unknown;
  note?: unknown;
}

function pastRef(p: PastSaid, quote: string): ConsistencyHit["past"] {
  return {
    text: squash(quote).replace(/^["'“”‘’…]+|["'“”‘’…]+$/g, "").trim(),
    ...(p.date ? { date: p.date } : {}),
    ...(p.permalink ? { permalink: p.permalink } : {}),
    ...(p.comment ? { comment: squash(p.comment).slice(0, 160) } : {}),
  };
}

function readConflict(c: RawConflict, spans: ReadonlyMap<string, SentenceSpan>, past: readonly PastSaid[]): { key: string; hit: ConsistencyHit } | null {
  const sentence = typeof c.sentence === "string" ? c.sentence.trim() : "";
  const span = spans.get(sentence);
  const pm = typeof c.past === "string" ? /^P(\d+)$/.exec(c.past.trim()) : null;
  const p = pm ? past[Number(pm[1]) - 1] : undefined;
  const quote = typeof c.quote === "string" ? c.quote : "";
  if (!span || !p || !isVerbatim(quote, p.text)) return null;
  const note = typeof c.note === "string" && c.note.trim() ? c.note.trim().slice(0, 120) : "예전 답과 다른 말이에요";
  return { key: sentence.replace(/\d+$/, ""), hit: { sentenceStart: span.start, sentenceEnd: span.end, past: pastRef(p, quote), note } };
}

/**
 * 모델 답 정리: 없는 문장·없는 예전 답·원문에 없는 구절은 버리고, 한 문장에는 한 건만.
 * 결과는 벌 표시(key)별 목록.
 */
export function normalizeConflicts(raw: unknown, drafts: readonly DraftForCheck[], past: readonly PastSaid[]): Record<string, ConsistencyHit[]> {
  const spans = new Map<string, SentenceSpan>();
  for (const d of drafts) sentenceSpans(d.text).forEach((s, i) => spans.set(`${d.key}${i + 1}`, s));
  const list = (raw as { conflicts?: unknown } | null)?.conflicts;
  const out: Record<string, ConsistencyHit[]> = Object.fromEntries(drafts.map((d) => [d.key, [] as ConsistencyHit[]]));
  for (const c of Array.isArray(list) ? list : []) {
    const got = readConflict((c ?? {}) as RawConflict, spans, past);
    if (!got || !out[got.key]) continue;
    if (out[got.key].some((h) => h.sentenceStart === got.hit.sentenceStart)) continue;
    out[got.key].push(got.hit);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.sentenceStart - b.sentenceStart);
  return out;
}

/** 칠하기에 예전 답 어긋남을 더한다. 관문·근거 칠하기와 겹치는 문장은 그쪽을 살린다. 보내기는 막지 않는다. */
export function withPastHits(result: GateResult, hits: readonly ConsistencyHit[] | undefined, text: string): GateResult {
  const extra: GateHit[] = (hits ?? [])
    .filter((h) => h.sentenceEnd <= text.length && h.sentenceStart < h.sentenceEnd)
    .filter((h) => !result.hits.some((g) => g.start < h.sentenceEnd && h.sentenceStart < g.end))
    .map((h) => ({
      start: h.sentenceStart,
      end: h.sentenceEnd,
      phrase: text.slice(h.sentenceStart, h.sentenceEnd),
      kind: PAST_HIT_KIND,
      action: "check" as const,
      reason: h.note,
      past: h.past,
    }));
  if (!extra.length) return result;
  return { status: result.status, hits: [...result.hits, ...extra].sort((a, b) => a.start - b.start) };
}

/** 글이 바뀌었으면 옛 위치는 버린다 (문장이 그대로면 새 위치로 옮긴다). */
export function remapHits(hits: readonly ConsistencyHit[] | undefined, from: string, to: string): ConsistencyHit[] {
  if (!hits?.length) return [];
  if (from === to) return [...hits];
  const out: ConsistencyHit[] = [];
  for (const h of hits) {
    const sentence = from.slice(h.sentenceStart, h.sentenceEnd);
    const at = sentence ? to.indexOf(sentence) : -1;
    if (at >= 0) out.push({ ...h, sentenceStart: at, sentenceEnd: at + sentence.length });
  }
  return out;
}
