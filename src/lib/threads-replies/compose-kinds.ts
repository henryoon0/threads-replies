// 토글 초안의 답 조각 종류 (2026-09-29 박약사 운영자가 직접 정한 답 카테고리 5개).
//
//   empathy    공감 + 성실 장문       joke        드립 + 짧은 건강상식 "뒤통수"
//   principle  원리 설명              ingredient  성분 설명
//   product    제품 추천 (약국 · 온라인 건기식 · 해외 직구)
//
// 주인의 실제 답을 문장 단위로 이 종류에 태깅한다(scripts/personas/build-owner-categories.ts, Opus 한 번).
// 태깅 결과는 팩 private/voice-labels.json 에 남고, 두 곳이 쓴다:
//   1) 토글 초안(compose.ts): 켠 종류마다 그 종류의 실제 답 조각을 레퍼런스로 싣는다.
//   2) 기본 토글 제안: 비슷한 댓글에 주인이 실제로 넣은 조각 종류.
// 순수 — I/O 없음.

import { textSimilarity } from "@/lib/content-ideas-style-eval";

export const COMPOSE_KINDS = ["empathy", "joke", "principle", "ingredient", "product"] as const;
export type ComposeKind = (typeof COMPOSE_KINDS)[number];

export const PRODUCT_CHANNELS = ["pharmacy", "online", "overseas"] as const;
export type ProductChannel = (typeof PRODUCT_CHANNELS)[number];

export const KIND_NAME: Record<ComposeKind, string> = {
  empathy: "공감 + 성실 장문",
  joke: "드립 + 짧은 건강상식",
  principle: "원리 설명",
  ingredient: "성분 설명",
  product: "제품 추천",
};

export const CHANNEL_NAME: Record<ProductChannel, string> = {
  pharmacy: "약국",
  online: "온라인 건기식",
  overseas: "해외 직구",
};

/** 문장 태그: 다섯 종류 + 제품은 경로별 + 어디에도 안 드는 문장(되묻기·인사·맺음) */
export type SentenceTag = Exclude<ComposeKind, "product"> | `product-${ProductChannel}` | "other";

export const SENTENCE_TAGS: readonly SentenceTag[] = [
  "empathy",
  "joke",
  "principle",
  "ingredient",
  "product-pharmacy",
  "product-online",
  "product-overseas",
  "other",
];

export function tagKind(tag: SentenceTag): ComposeKind | null {
  if (tag === "other") return null;
  return tag.startsWith("product-") ? "product" : (tag as ComposeKind);
}

export function tagChannel(tag: SentenceTag): ProductChannel | null {
  return tag.startsWith("product-") ? (tag.slice("product-".length) as ProductChannel) : null;
}

// ── 문장 나누기 (순수) ──────────────────────────────────────────────

/** 답을 태깅 단위(문장)로 나눈다. 문장부호 뒤 공백·줄바꿈, "1/" 번호 앞에서 자른다. */
export function replyUnits(reply: string): string[] {
  return reply
    .split(/(?<=[.!?])\s+|\n+|\s+(?=\d\/\s)/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// ── 태깅 결과 검증 (순수) ───────────────────────────────────────────

export interface LabelDraftCheck {
  /** 쌍 라벨(p001…) → 문장마다 태그 */
  tags: Map<string, SentenceTag[]>;
  errors: string[];
  warnings: string[];
}

const MAX_MISSING_RATIO = 0.05;

function readTags(raw: unknown): SentenceTag[] | null {
  if (!Array.isArray(raw)) return null;
  const tags = raw.map((t) => String(t).trim());
  return tags.every((t) => (SENTENCE_TAGS as readonly string[]).includes(t)) ? (tags as SentenceTag[]) : null;
}

function checkOne(label: string, raw: unknown, units: readonly string[], errors: string[]): SentenceTag[] | null {
  const tags = readTags(raw);
  if (!tags) {
    errors.push(`${label}: 태그가 배열이 아니거나 모르는 태그가 있음`);
    return null;
  }
  if (tags.length !== units.length) {
    errors.push(`${label}: 문장 ${units.length}개인데 태그 ${tags.length}개`);
    return null;
  }
  return tags;
}

/**
 * 모델 JSON({labels: {p001: ["principle", ...]}})을 검사한다. units = 라벨별 문장 목록(프롬프트에 붙인 것).
 * 태그 수가 문장 수와 다르거나 모르는 태그면 그 쌍은 오류. 빠진 쌍이 5% 넘으면 오류.
 */
export function checkLabelDraft(raw: unknown, units: ReadonlyMap<string, readonly string[]>): LabelDraftCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const o = ((raw ?? {}) as { labels?: unknown }).labels;
  const given = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  const tags = new Map<string, SentenceTag[]>();
  const missing: string[] = [];
  for (const [label, list] of units) {
    if (!(label in given)) {
      missing.push(label);
      continue;
    }
    const t = checkOne(label, given[label], list, errors);
    if (t) tags.set(label, t);
  }
  if (missing.length > units.size * MAX_MISSING_RATIO) errors.push(`태그 없는 답 ${missing.length}/${units.size}개 (예: ${missing.slice(0, 6).join(", ")})`);
  else if (missing.length) warnings.push(`태그 없는 답 ${missing.length}개`);
  return { tags, errors, warnings };
}

// ── 쌍 라벨 (순수) ──────────────────────────────────────────────────

export interface LabelSegment {
  kind: ComposeKind;
  channel?: ProductChannel;
  text: string;
}

export interface PairLabel {
  /** 이 답에 든 종류 (등장 순) */
  kinds: ComposeKind[];
  /** 글자 수가 가장 많은 종류 */
  primary: ComposeKind;
  channels: ProductChannel[];
  /** 같은 종류가 이어진 문장을 한 조각으로 묶은 것 */
  segments: LabelSegment[];
}

function charLen(s: string): number {
  return [...s].length;
}

function pushSegment(out: LabelSegment[], kind: ComposeKind, channel: ProductChannel | null, text: string): void {
  const last = out[out.length - 1];
  if (last && last.kind === kind && (last.channel ?? null) === channel) {
    last.text = `${last.text} ${text}`;
    return;
  }
  out.push(channel ? { kind, channel, text } : { kind, text });
}

function primaryOf(segments: readonly LabelSegment[]): ComposeKind {
  const size = new Map<ComposeKind, number>();
  for (const s of segments) size.set(s.kind, (size.get(s.kind) ?? 0) + charLen(s.text));
  return [...size.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** 문장 + 태그 → 쌍 라벨. 다섯 종류 중 하나도 없으면(전부 other) null. */
export function toPairLabel(units: readonly string[], tags: readonly SentenceTag[]): PairLabel | null {
  const segments: LabelSegment[] = [];
  units.forEach((text, i) => {
    const kind = tagKind(tags[i]);
    if (kind) pushSegment(segments, kind, tagChannel(tags[i]), text);
  });
  if (!segments.length) return null;
  const kinds = [...new Set(segments.map((s) => s.kind))];
  const channels = [...new Set(segments.map((s) => s.channel).filter((c): c is ProductChannel => !!c))];
  return { kinds, primary: primaryOf(segments), channels, segments };
}

// ── 말투 위반 (순수) ────────────────────────────────────────────────

export interface VoiceViolation {
  kind: "ellipsis" | "laugh" | "sympathy" | "emoji" | "coined";
  phrase: string;
}

const ELLIPSIS = /…+|\.{2,}/g;
const LAUGH = /[ㅋㅎㅠㅜ]{2,}/g;
const EMOJI = /\p{Extended_Pictographic}/gu;
/** 운영자가 "절대 안 쓴다"고 한 달래기 문형 (코드 검사용. 프롬프트에는 싣지 않는다) */
const SYMPATHY =
  /(어떡해|어떻게\s?해|속상하겠|속상했겠|마음이\s?아프|맘이\s?아프|힘드셨겠|힘들었겠|힘들겠다|얼마나\s?힘들|걱정\s?많이\s?되|걱정되겠|안쓰럽|짠하|토닥|안타깝다|너무\s?안됐)/g;

/**
 * 운영자가 반려한 AI 말버릇 (2026-09-30 henry "왜 계속 쓰이는지 모르겠다"): 영양소·몸을 물건에 빗댄 새 이름("철분 탱크" 류)과
 * 교과서 번역어("붉은 살코기" = red meat). 운영자 실제 답에는 한 번도 없다. 코드 검사용 — 프롬프트에 싣지 않는다(인용하면 오히려 심긴다).
 */
const COINED = /붉은\s?(?:살코기|고기)|적색육|[가-힣]{1,6}\s?탱크/g;

function allMatches(re: RegExp, kind: VoiceViolation["kind"], text: string): VoiceViolation[] {
  return [...text.matchAll(re)].map((m) => ({ kind, phrase: m[0] }));
}

/** 운영자 말투에 없는 것: 말줄임, 웃음·울음 기호, 이모지, 달래기 문형, 반려한 말버릇. */
export function voiceViolations(text: string): VoiceViolation[] {
  return [
    ...allMatches(ELLIPSIS, "ellipsis", text),
    ...allMatches(LAUGH, "laugh", text),
    ...allMatches(EMOJI, "emoji", text),
    ...allMatches(SYMPATHY, "sympathy", text),
    ...allMatches(COINED, "coined", text),
  ];
}

/** 기호만 기계적으로 고친다: 말줄임 → 마침표, 웃음·울음 기호·이모지 삭제. 달래기 문형·반려한 말버릇은 못 고친다(다시 쓰기). */
export function stripMarkers(text: string): string {
  return text
    .replace(/\s*(?:…+|\.{2,})\s*(?=[\n]|$)/g, ".")
    .replace(/\s*(?:…+|\.{2,})\s*/g, ". ")
    .replace(/\s*[ㅋㅎㅠㅜ]{2,}/g, "")
    .replace(EMOJI, "")
    .replace(/\.\s*\./g, ".")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .trim();
}

/** 레퍼런스로 실어도 되는 실제 답(조각)인가: 말투 위반이 없어야 한다. 나쁜 예시가 곧 나쁜 말투의 공급원이다. */
export function isCleanExample(text: string): boolean {
  return voiceViolations(text).length === 0;
}

// ── 기본 토글 제안 (순수) ───────────────────────────────────────────

export interface LabeledComment {
  comment: string;
  label: PairLabel;
}

export interface ToggleSuggestion {
  kinds: ComposeKind[];
  channels: ProductChannel[];
  /** 근거가 된 비슷한 댓글 수 */
  neighbors: number;
}

const NEIGHBORS = 7;
const KIND_SHARE = 0.4;

function weightedShare<T>(near: readonly { w: number; has: (x: T) => boolean }[], x: T): number {
  const total = near.reduce((n, e) => n + e.w, 0) || 1;
  return near.reduce((n, e) => n + (e.has(x) ? e.w : 0), 0) / total;
}

/**
 * 비슷한 댓글(글자 유사도 상위 7개)에 주인이 넣은 종류를 유사도 가중으로 센다.
 * 40% 넘게 들어간 종류를 켠다. 하나도 안 넘으면 가장 비율 높은 종류 하나.
 * 제품을 켜면 경로도 같은 방식으로 고르고, 없으면 약국.
 */
export function suggestToggles(comment: string, pool: readonly LabeledComment[]): ToggleSuggestion {
  const near = pool
    .map((p) => ({ p, w: textSimilarity(comment, p.comment) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, NEIGHBORS)
    .map(({ p, w }) => ({ label: p.label, w: Math.max(w, 0.01) }));
  if (!near.length) return { kinds: ["principle"], channels: [], neighbors: 0 };
  const byKind = near.map((n) => ({ w: n.w, has: (k: ComposeKind) => n.label.kinds.includes(k) }));
  const shares = COMPOSE_KINDS.map((k) => ({ k, s: weightedShare(byKind, k) }));
  let kinds = shares.filter((x) => x.s >= KIND_SHARE).map((x) => x.k);
  if (!kinds.length) kinds = [shares.sort((a, b) => b.s - a.s)[0].k];
  if (kinds.includes("empathy") && kinds.includes("joke")) kinds = kinds.filter((k) => k !== "joke");
  return { kinds, channels: kinds.includes("product") ? suggestChannels(near) : [], neighbors: near.length };
}

function suggestChannels(near: readonly { label: PairLabel; w: number }[]): ProductChannel[] {
  const withProduct = near.filter((n) => n.label.channels.length);
  const byChannel = withProduct.map((n) => ({ w: n.w, has: (c: ProductChannel) => n.label.channels.includes(c) }));
  const channels = PRODUCT_CHANNELS.filter((c) => byChannel.length && weightedShare(byChannel, c) >= KIND_SHARE);
  return channels.length ? channels : ["pharmacy"];
}
