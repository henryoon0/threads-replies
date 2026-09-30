// 초안 벌끼리 얼마나 닮았는지 재고, 서로 먼 카테고리를 고른다 (09-29 henry: "말투가 너무 다 동일한 느낌").
//
// 주인의 실제 다양성 축 = categories.json 의 카테고리 통계(길이·첫 마디·끝맺음·이모지·웃음).
// 이 파일은 순수 함수만 둔다: 벌 특징 재기 · 닮음 지표 · 너무 닮은 벌 찾기 · 먼 카테고리 고르기 · 목표 특징 한 줄.

import { textSimilarity } from "@/lib/content-ideas-style-eval";
import { charLength, endingOf, type ReplyCategory } from "@/lib/personas/categories";

/** 두 벌의 글자쌍 유사도가 이 값을 넘으면 너무 닮았다고 본다. */
export const SIMILARITY_LIMIT = 0.45;

/** 다른 버전 고르기에서 댓글에 맞는 순위 한 칸당 빼는 값 */
const MORE_FIT_WEIGHT = 0.3;

export type LengthBucket = "짧음" | "중간" | "김";

export interface OptionTraits {
  length: number;
  bucket: LengthBucket;
  firstWord: string;
  ending: string;
  emoji: boolean;
  laugh: boolean;
}

const EMOJI = /\p{Extended_Pictographic}/u;

export function lengthBucket(n: number): LengthBucket {
  return n <= 30 ? "짧음" : n <= 90 ? "중간" : "김";
}

function firstWordOf(text: string): string {
  return (text.trim().split(/\s+/)[0] ?? "").replace(/[!?.,~…]+$/u, "");
}

export function optionTraits(text: string): OptionTraits {
  const length = charLength(text);
  return {
    length,
    bucket: lengthBucket(length),
    firstWord: firstWordOf(text),
    ending: endingOf(text),
    emoji: EMOJI.test(text),
    laugh: /(ㅋㅋ|ㅎㅎ)/.test(text),
  };
}

function openingOf(text: string): string {
  return text.trim().split(/\s+/).slice(0, 2).join(" ").replace(/[!?.,~…]+$/u, "");
}

/** 두 벌이 너무 닮았나: 글자쌍 유사도가 높거나, 여는 두 마디가 같거나("네 맞아요"), 길이 구간·첫 마디·끝맺음이 모두 같다. */
export function tooSimilar(a: string, b: string): boolean {
  if (textSimilarity(a, b) > SIMILARITY_LIMIT) return true;
  if (a.trim().split(/\s+/).length > 1 && b.trim().split(/\s+/).length > 1 && openingOf(a) === openingOf(b)) return true;
  const x = optionTraits(a);
  const y = optionTraits(b);
  return x.bucket === y.bucket && x.firstWord === y.firstWord && x.ending === y.ending;
}

/** 앞 벌과 너무 닮은 첫 벌의 번호 (다시 쓸 벌). 없으면 -1. 앞 벌을 살리고 뒤 벌을 고친다. */
export function offendingIndex(drafts: readonly string[]): number {
  for (let j = 1; j < drafts.length; j++) {
    for (let i = 0; i < j; i++) if (tooSimilar(drafts[i], drafts[j])) return j;
  }
  return -1;
}

export interface SamenessReport {
  lengths: number[];
  /** 가장 긴 벌 / 가장 짧은 벌 */
  lengthRatio: number;
  /** 서로 다른 길이 구간 수 (1~3) */
  buckets: number;
  sameFirstWordPairs: number;
  sameEndingPairs: number;
  /** 이모지 있는 벌 수 */
  emojiOptions: number;
  laughOptions: number;
  maxBigram: number;
  meanBigram: number;
  /** tooSimilar 쌍 수 */
  similarPairs: number;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function samenessReport(drafts: readonly string[]): SamenessReport {
  const t = drafts.map(optionTraits);
  const sims: number[] = [];
  let sameFirst = 0;
  let sameEnd = 0;
  let similar = 0;
  for (let i = 0; i < drafts.length; i++) {
    for (let j = i + 1; j < drafts.length; j++) {
      sims.push(textSimilarity(drafts[i], drafts[j]));
      if (t[i].firstWord === t[j].firstWord) sameFirst++;
      if (t[i].ending === t[j].ending) sameEnd++;
      if (tooSimilar(drafts[i], drafts[j])) similar++;
    }
  }
  const lengths = t.map((x) => x.length);
  return {
    lengths,
    lengthRatio: lengths.length ? round(Math.max(...lengths) / Math.max(1, Math.min(...lengths))) : 0,
    buckets: new Set(t.map((x) => x.bucket)).size,
    sameFirstWordPairs: sameFirst,
    sameEndingPairs: sameEnd,
    emojiOptions: t.filter((x) => x.emoji).length,
    laughOptions: t.filter((x) => x.laugh).length,
    maxBigram: round(sims.length ? Math.max(...sims) : 0),
    meanBigram: round(sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0),
    similarPairs: similar,
  };
}

// ── 카테고리 고르기 ─────────────────────────────────────────────────

function topEnding(c: ReplyCategory): string {
  return c.stats.endings[0]?.ending ?? "기타";
}

function habit(c: ReplyCategory, name: string): number {
  return (c.stats.habits[name] ?? 0) / 100;
}

/** 두 카테고리의 실측 말투 거리 (0~약 4): 길이 · 대표 끝맺음 · 이모지 · 웃음 · 설명 밀도(문장 수). */
export function categoryDistance(a: ReplyCategory, b: ReplyCategory): number {
  const len = Math.abs(Math.log((a.stats.lengthMedian + 5) / (b.stats.lengthMedian + 5))) / Math.log(4);
  const ending = topEnding(a) === topEnding(b) ? 0 : 0.6;
  const emoji = Math.abs(habit(a, "이모지") - habit(b, "이모지"));
  const laugh = Math.abs(habit(a, "ㅋㅋ·ㅎㅎ") - habit(b, "ㅋㅋ·ㅎㅎ"));
  const sentences = Math.min(1, Math.abs(a.stats.sentencesMedian - b.stats.sentencesMedian) / 3);
  return Math.min(1.5, len) + ending + emoji + laugh + sentences;
}

/**
 * 맞는 순서로 줄 세운 후보에서 k개를 고른다. 첫째는 가장 잘 맞는 것, 그다음은
 * "이미 고른 것과의 최소 거리"가 가장 먼 것 (맞는 순서가 앞일수록 조금 가산).
 */
export function pickDiverseCategories(ranked: readonly ReplyCategory[], k = 3): ReplyCategory[] {
  if (!ranked.length) return [];
  const picked = [ranked[0]];
  while (picked.length < Math.min(k, ranked.length)) {
    let best: ReplyCategory | null = null;
    let bestScore = -Infinity;
    ranked.forEach((c, rank) => {
      if (picked.includes(c)) return;
      const score = Math.min(...picked.map((p) => categoryDistance(p, c))) - 0.08 * rank;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    });
    if (!best) break;
    picked.push(best);
  }
  return picked;
}

/**
 * "다른 버전" 다음 카테고리: 이미 쓴 벌들과의 최소 거리에서 댓글에 덜 맞는 순위만큼 뺀다.
 * 멀기만 하고 이 댓글과 상관없는 유형(예: 질문에 "다음에 만나요")이 먼저 나오지 않게 맞음 가중을 세게 둔다.
 */
export function nextDistinctCategory(ranked: readonly ReplyCategory[], usedIds: readonly string[]): ReplyCategory | null {
  const used = ranked.filter((c) => usedIds.includes(c.id));
  const rest = ranked.filter((c) => !usedIds.includes(c.id));
  if (!rest.length) return null;
  if (!used.length) return rest[0];
  let best = rest[0];
  let bestScore = -Infinity;
  rest.forEach((c, rank) => {
    const score = Math.min(...used.map((u) => categoryDistance(u, c))) - MORE_FIT_WEIGHT * rank;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  });
  return best;
}

/** 카테고리 실측으로 만든 이번 벌의 목표 특징 한 줄. */
export function targetTraits(c: ReplyCategory): string {
  const s = c.stats;
  const first = s.firstWords.slice(0, 3).map((w) => `"${w.word}"`).join(", ");
  const endings = s.endings.slice(0, 2).map((e) => `${e.ending} ${e.pct}%`).join(", ");
  const emoji = habit(c, "이모지");
  const laugh = habit(c, "ㅋㅋ·ㅎㅎ");
  return [
    `길이 ${s.lengthMedian}자 안팎(길어도 ${s.lengthP90}자), 문장 ${s.sentencesMedian}개 안팎`,
    first ? `첫 마디 예 ${first}` : "",
    endings ? `끝맺음 ${endings}` : "",
    emoji >= 0.3 ? "이모지 하나를 쓴다" : emoji < 0.1 ? "이모지는 쓰지 않는다" : "이모지는 써도 되고 안 써도 된다",
    laugh >= 0.3 ? "ㅋㅋ·ㅎㅎ 웃음을 넣는다" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
