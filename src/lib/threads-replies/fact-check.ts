// 근거 없는 사실 문장 거르기 (지어낸 사실이 답글에 섞이지 않게).
//
// 질문 댓글 초안에서 사실을 말하는 문장(숫자·이름·기능·가격·날짜·효과·용량)은
// 그 사실이 근거 인용에 실제로 적혀 있어야 남는다. 없으면 초안에서 빼고 "근거 없어 뺀 문장"으로 남긴다.
//   굳은 사실 = 숫자·영문 이름. 근거 글(인용·제목·한국어 요약)이나 댓글·내 글에 그 말이 그대로 있어야 한다.
//   말랑한 사실 = 효과·용량·가격 같은 말만 있고 숫자·영문이 없는 문장. 초안에서는 근거 id 를 달아야 하고,
//     그 근거와 낱말이 하나 이상 겹쳐야 한다. 완성된 답(근거 id 없음)에서는 어느 근거와든 낱말이 겹치면 된다.
//   권유·질문·맞장구(해보세요, 확인해봐, ~할까요?)는 굳은 사실이 없으면 사실 문장으로 보지 않는다.
//
// Pure — I/O 없음.

import type { AnswerSource, DraftSentence } from "./model";

export interface DroppedSentence {
  text: string;
  reason: string;
}

/** 근거로 칠 글 한 덩어리 (id 가 있으면 초안의 sourceIds 로 가리킬 수 있다). */
export interface FactCorpus {
  id?: string;
  text: string;
}

const LIST_MARK = /^\s*(?:\d{1,2}(?:\/|[.)](?=\s))|[-•·](?=\s))\s*/;
const SOFT_CUES = [
  "효과", "도움이 돼", "도움 돼", "도움돼", "도움이 된", "도움 된", "흡수", "부작용", "용량", "복용", "권장", "하루", "가격", "할인", "출시", "지원", "기능", "무료", "유료",
  "연구", "논문", "근거", "발암", "위험", "안 좋", "좋다는", "해롭", "낮춰", "높여", "개선", "예방", "줄어", "늘어", "올라", "내려",
  "금지", "허가", "처방", "품귀", "단종", "업데이트", "버전", "한도", "요금제가",
];
const ADVICE_END = /(보세요|봐요|봐|해봐|세요|드려요|드릴게요|볼게요|까요|까\?|래요|래\?|줘|주세요|어때요|어때|요\?|야\?|지\?|\?)[\s!~ㅎㅋ.^-]*$/;
const ADVICE_ANY = /(물어보|물어봐|확인해|확인하|가봐|가보|상담해|상담받|체크해|방법이야|방법이에요|방법이에여)/;
const HEDGE_OPINION = /(것 같아|거 같아|것 같에|거 같에|듯해|듯요|생각해|봐요$)/;
const STOP = new Set(["그리고", "근데", "그래서", "지금", "이건", "그건", "정도", "진짜", "너무", "조금", "제가", "저는", "내가", "나는", "우리", "요즘", "혹시"]);
const ENDINGS = ["이에요", "예요", "이라", "에서", "으로", "한테", "까지", "부터", "이랑", "이나", "보다", "처럼", "로", "이", "가", "을", "를", "은", "는", "에", "도", "만", "와", "과", "랑", "나", "요"];

function stripMark(text: string): string {
  return text.replace(LIST_MARK, "");
}

/** 숫자 토큰 (쉼표·소수점 정리). "2~4" → ["2","4"] */
export function numberTokens(text: string): string[] {
  return [...stripMark(text).matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/,/g, ""));
}

/** 영문 이름·용어 (2글자 이상). 대소문자 무시로 비교한다. */
export function nameTokens(text: string): string[] {
  return [...text.matchAll(/[A-Za-z][A-Za-z0-9#.-]*[A-Za-z0-9#]|[A-Za-z]{2,}/g)]
    .map((m) => m[0].toLowerCase())
    .filter((t) => t.length >= 2);
}

function hasSoftCue(text: string): boolean {
  return SOFT_CUES.some((c) => text.includes(c));
}

/** 한국어 낱말 (조사 떼고 2글자 이상, 흔한 말 제외) */
export function koreanTerms(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)) {
    if (!/[가-힣]/.test(raw)) continue;
    let w = raw;
    const e = ENDINGS.find((x) => w.endsWith(x) && w.length - x.length >= 2);
    if (e) w = w.slice(0, -e.length);
    if (w.length >= 2 && !STOP.has(w) && !out.includes(w)) out.push(w);
  }
  return out;
}

export type FactKind = "none" | "hard" | "soft";

/** 이 문장이 사실을 말하나. hard = 숫자·영문 이름이 있음, soft = 효과·용량 같은 말만 있음. */
export function factKind(sentence: string): FactKind {
  const body = stripMark(sentence);
  if (numberTokens(body).length || nameTokens(body).length) return "hard";
  if (ADVICE_END.test(body.trim()) || ADVICE_ANY.test(body)) return "none";
  if (!hasSoftCue(body)) return "none";
  return HEDGE_OPINION.test(body) && !/알기론|라고|래요|대요|다는/.test(body) ? "none" : "soft";
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/,/g, "");
}

/** 굳은 사실(숫자·영문)이 모두 corpus 에 있으면 null, 없으면 빠진 토큰 */
function missingHard(sentence: string, corpus: string): string[] {
  const hay = normalize(corpus);
  const nums = numberTokens(sentence).filter((n) => !new RegExp(`(^|[^0-9.])${n.replace(/\./g, "\\.")}($|[^0-9])`).test(hay));
  const names = nameTokens(sentence).filter((n) => !hay.includes(n));
  return [...nums, ...names];
}

function overlaps(sentence: string, corpus: string): boolean {
  const hay = corpus.toLowerCase();
  return koreanTerms(stripMark(sentence)).some((t) => hay.includes(t));
}

/** 근거 한 건이 사실 대조에 내놓는 글: 인용 + 제목 + 한국어 요약 */
export function sourceCorpus(s: AnswerSource): FactCorpus {
  return { id: s.id, text: [s.title, s.quote].join("\n") };
}

/** 되풀이해도 되는 믿을 글: 댓글·대화 + 주인이 예전에 실제로 단 답. 여기 있는 숫자·이름은 지어낸 말이 아니다. */
export function trustedContext(parts: { thread: readonly string[]; pastSaid?: readonly { text: string }[] }): string {
  return [...parts.thread, ...(parts.pastSaid ?? []).map((p) => p.text)].filter(Boolean).join("\n");
}

/**
 * 문장 하나를 근거와 대조한다. null = 통과, 문자열 = 뺀 이유.
 * cited 가 주어지면(초안) 말랑한 사실은 그 근거와 겹쳐야 한다. 없으면(완성된 답) 어느 근거와든 겹치면 된다.
 * context = 댓글·대화·내 글처럼 되풀이해도 되는 글 (댓글이 말한 "2.5"를 다시 말하는 건 지어낸 게 아니다).
 */
export function unsupportedReason(sentence: string, corpora: readonly FactCorpus[], context: string, cited?: readonly string[]): string | null {
  const kind = factKind(sentence);
  if (kind === "none") return null;
  const all = [context, ...corpora.map((c) => c.text)].join("\n");
  if (kind === "hard") {
    const miss = missingHard(sentence, all);
    return miss.length ? `자료에 없는 말: ${miss.slice(0, 3).join(", ")}` : null;
  }
  if (cited) {
    const pool = corpora.filter((c) => c.id && cited.includes(c.id));
    if (!pool.length) return "효과·용량 같은 사실인데 단 근거가 없어요";
    return overlaps(sentence, pool.map((c) => c.text).join("\n")) ? null : "단 근거에 이 내용이 없어요";
  }
  return overlaps(sentence, all) ? null : "자료에 없는 사실이에요";
}

/** 초안 문장 목록에서 근거 없는 사실 문장을 뺀다. */
export function dropUnsupported(
  sentences: readonly DraftSentence[],
  corpora: readonly FactCorpus[],
  context: string
): { kept: DraftSentence[]; dropped: DroppedSentence[] } {
  const kept: DraftSentence[] = [];
  const dropped: DroppedSentence[] = [];
  for (const s of sentences) {
    const reason = unsupportedReason(s.text, corpora, context, s.sourceIds);
    if (reason) dropped.push({ text: s.text, reason });
    else kept.push(s);
  }
  return { kept, dropped };
}

/** 초안 원문에서 뺀 문장을 지운다. 문장을 못 찾으면 남은 문장을 이어 새로 만든다. */
export function removeFromDraft(draft: string, dropped: readonly DroppedSentence[], kept: readonly DraftSentence[]): string {
  let out = draft;
  for (const d of dropped) {
    if (!out.includes(d.text)) return kept.map((s) => s.text).join(" ");
    out = out.replace(d.text, "");
  }
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .filter((line, i, lines) => !(line === "" && lines[i - 1] === ""))
    .join("\n")
    .replace(/^(?:\d{1,2}\/\s*)$/gm, "")
    .trim();
}

/** 완성된 답 글에서 문장 구간 [start, end) 을 나눈다 (마침표·물음표·느낌표·물결·줄바꿈 기준). */
export function sentenceSpans(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  const re = /[^.!?~\n]+[.!?~]*/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (!t) continue;
    const start = (m.index ?? 0) + lead;
    out.push({ start, end: start + t.length, text: t });
  }
  return out;
}

/** 완성된 답에서 근거 없는 사실 문장 구간 (화면 칠하기용). */
export function unsupportedSpans(
  text: string,
  sources: readonly AnswerSource[],
  context: string
): { start: number; end: number; text: string; reason: string }[] {
  const corpora = sources.map(sourceCorpus);
  return sentenceSpans(text).flatMap((s) => {
    const reason = unsupportedReason(s.text, corpora, context);
    return reason ? [{ ...s, reason }] : [];
  });
}
