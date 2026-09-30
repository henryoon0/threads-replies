// 주제 입장 카드 — "이 주제에 내가 해 온 말" (docs/reply-persona-design.md 6장 12단계, 픽 4번).
//
// 댓글 하나에 대해 주인이 예전에 같은 주제로 한 말(내 답글·내 글)을 찾아 번호를 붙이고,
// 짧은 요약 1~2문장을 쓴다. 요약은 항목에 적힌 말만 다시 말하고 문장마다 [n]을 단다.
// 관련 항목이 2개 미만이면 모델을 부르지 않는다 — 한 건을 "입장"이라 부르면 과장이다.
// 학습 제외 답(learn=false: 처방약·용량·제품 권유)은 카드에 절대 올리지 않는다.

import { generateText } from "@/lib/ai/generate";
import { tryParseModelJson } from "@/lib/ai/json";
import { readPersona } from "@/lib/personas/registry";
import { knowledgeTerms, matchedTermCount, retrievalTerms, weightedMatch, type KnowledgeHit } from "@/lib/personas/knowledge/rows";
import { termWeights } from "@/lib/personas/knowledge/sources";
import { searchPastReplies, searchPosts, type KnowledgeSource } from "@/lib/personas/knowledge/supabase";
import { envMs } from "./storage";

export interface StanceItem {
  n: number;
  text: string;
  date?: string;
  permalink?: string;
}

export interface Stance {
  topic: string;
  summary: string;
  items: StanceItem[];
  source: KnowledgeSource;
}

export const STANCE_MAX_ITEMS = 5;
export const STANCE_MIN_ITEMS = 2;
const MAX_REPLY_ITEMS = 4;
const MAX_POST_ITEMS = 2;
const ITEM_CHARS = 220;
const TOPIC_CHARS = 12;

// ── 순수 부분 ─────────────────────────────────────────────

/** 감사 인사·이모지뿐인 답은 입장이 아니다. */
export function hasSubstance(text: string): boolean {
  const core = text.replace(/[ㄱ-ㅎㅏ-ㅣ]|[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  if (Array.from(core).length < 8) return false;
  return !/^(감사|고맙|좋은\s?글|축하|화이팅|응원)/.test(core);
}

/** 긴 글에서 첫 검색어 둘레를 잘라 보여준다. 앞뒤를 자르면 … 을 붙인다. */
export function excerptAround(text: string, terms: readonly string[], max = ITEM_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const lower = flat.toLowerCase();
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, Math.min(at - Math.floor(max / 3), flat.length - max));
  const piece = flat.slice(start, start + max).trim();
  return `${start > 0 ? "…" : ""}${piece}${start + max < flat.length ? "…" : ""}`;
}

/** 검색어가 3개 이상이면 2개 이상 걸려야 관련 있다고 본다 (한 낱말만 겹친 잡담을 거름). */
export function relevanceFloor(termCount: number): number {
  return termCount >= 3 ? 2 : 1;
}

/** 무게 문턱: 검색어 무게 합의 40% 이상을 품어야 한다. 흔한 낱말 하나만 겹친 글("클로드")을 거른다. */
export const WEIGHT_SHARE_FLOOR = 0.4;

function weightFloor(weights: ReadonlyMap<string, number> | undefined): number {
  if (!weights) return 0;
  let total = 0;
  for (const w of weights.values()) total += w;
  return total * WEIGHT_SHARE_FLOOR;
}

/** 같은 문단이 글 칸과 이어 쓴 칸에 두 번 실린 경우를 한 건으로 본다. */
function dedupeKey(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 60);
}

/**
 * 후보에서 카드에 올릴 항목 고르기: learn=false·내용 없는 답·제외 id·중복 문단·무게 미달을 빼고,
 * 드문 낱말 무게 합 → 걸린 낱말 수 → 점수 → 최신 순. 답글 최대 4, 글 최대 2, 합쳐 최대 5.
 */
export function pickStanceHits(
  replies: readonly KnowledgeHit[],
  posts: readonly KnowledgeHit[],
  terms: readonly string[],
  opts: { excludeIds?: readonly string[]; weights?: ReadonlyMap<string, number> } = {}
): KnowledgeHit[] {
  const floor = relevanceFloor(terms.length);
  const minWeight = weightFloor(opts.weights);
  const skip = new Set(opts.excludeIds ?? []);
  const seen = new Set<string>();
  const rank = (hits: readonly KnowledgeHit[], max: number) =>
    hits
      .filter((h) => h.learn && !skip.has(h.id) && hasSubstance(h.body))
      .map((h) => ({ h, m: matchedTermCount(h, terms), w: weightedMatch(h, terms, opts.weights) }))
      .filter((x) => x.m >= floor && x.w >= minWeight)
      .sort((a, b) => b.w - a.w || b.m - a.m || b.h.score - a.h.score || (b.h.postedAt ?? "").localeCompare(a.h.postedAt ?? ""))
      .filter((x) => {
        const key = dedupeKey(x.h.body);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, max)
      .map((x) => x.h);
  return [...rank(replies, MAX_REPLY_ITEMS), ...rank(posts, MAX_POST_ITEMS)].slice(0, STANCE_MAX_ITEMS);
}

export function toStanceItems(hits: readonly KnowledgeHit[], terms: readonly string[]): StanceItem[] {
  return hits.map((h, i) => ({
    n: i + 1,
    text: excerptAround(h.body, terms),
    ...(h.postedAt ? { date: h.postedAt.slice(0, 10) } : {}),
    ...(h.permalink ? { permalink: h.permalink } : {}),
  }));
}

export function buildStancePrompt(input: {
  ownerName: string;
  commentText: string;
  hits: readonly KnowledgeHit[];
  items: readonly StanceItem[];
}): string {
  const lines = input.items.map((item, i) => {
    const hit = input.hits[i];
    const when = item.date ? `${item.date}, ` : "";
    const kind = hit?.kind === "post" ? "내 글" : "내 답글";
    const context = hit?.kind === "reply" && hit.commentBody ? ` — 받은 댓글(맥락일 뿐): «${excerptAround(hit.commentBody, [], 120)}»` : "";
    return `[${item.n}] (${when}${kind}${context})\n${item.text}`;
  });
  return [
    `아래 [번호] 항목은 ${input.ownerName}이(가) 예전에 스레드에 직접 쓴 글과 답글이다. 지금 들어온 댓글과 같은 주제다.`,
    "",
    `지금 댓글: «${input.commentText.trim().slice(0, 400)}»`,
    "",
    "항목:",
    ...lines,
    "",
    "할 일:",
    `1. topic: 항목들이 공통으로 다루는 주제를 ${TOPIC_CHARS}자 이내 명사구로.`,
    `2. summary: ${input.ownerName}이(가) 이 주제에 대해 해 온 말을 1~2문장, 해요체로 요약한다. 문장은 짧게(각 70자 안팎).`,
    "   - 항목에 적힌 내용만 다시 말한다. 항목에 없는 사실·추측·조언·평가를 보태지 않는다.",
    "   - 문장마다 근거 항목 번호를 [1]처럼 붙인다. 없는 번호는 쓰지 않는다.",
    "   - 받은 댓글 글은 맥락이다. 요약 대상은 주인이 한 말뿐이다.",
    "   - 항목끼리 말이 다르면 달라졌다고 그대로 쓴다.",
    '출력: {"topic": "...", "summary": "..."}',
  ].join("\n");
}

/** [n] 중 1..itemCount 밖의 번호를 지운다. "[1, 2]" 는 "[1][2]" 로 편다. */
export function clampCitations(text: string, itemCount: number): string {
  return text
    .replace(/\[(\d+(?:\s*[,、]\s*\d+)+)\]/g, (_, list: string) =>
      list
        .split(/[,、]/)
        .map((n) => `[${n.trim()}]`)
        .join("")
    )
    .replace(/\s*\[(\d+)\]/g, (whole, n: string) => {
      const k = Number(n);
      return k >= 1 && k <= itemCount ? whole : "";
    });
}

function firstSentences(text: string, max: number): string {
  const parts = text.split(/(?<=[.!?。](?:\s*\[\d+\])*)\s+(?!\[)/);
  return parts.slice(0, max).join(" ").trim();
}

/**
 * 모델 출력 → { topic, summary }. 주제는 12자, 요약은 2문장까지.
 * 인용이 하나도 남지 않은 요약은 확인할 수 없으니 버린다("").
 */
export function normalizeStance(raw: string, itemCount: number): { topic: string; summary: string } {
  const parsed = tryParseModelJson<{ topic?: unknown; summary?: unknown }>(raw) ?? {};
  const topic = Array.from(String(parsed.topic ?? "").replace(/["'«»\[\]]/g, "").replace(/\s+/g, " ").trim())
    .slice(0, TOPIC_CHARS)
    .join("")
    .trim();
  const cleaned = firstSentences(clampCitations(String(parsed.summary ?? "").replace(/\s+/g, " ").trim(), itemCount), 2);
  const summary = /\[\d+\]/.test(cleaned) ? cleaned : "";
  return { topic, summary };
}

/** 모델 없이 쓰는 주제: 검색어 앞 두 개. */
export function fallbackTopic(terms: readonly string[]): string {
  return Array.from(terms.slice(0, 2).join(" ")).slice(0, TOPIC_CHARS).join("");
}

// ── I/O ──────────────────────────────────────────────────

export function stanceTimeoutMs(): number {
  return envMs("THREADS_STANCE_TIMEOUT_MS", 60_000);
}

export interface StanceInput {
  personaId: string;
  commentText: string;
  postText: string;
  /** 캐시 열쇠. 없으면 캐시하지 않는다. */
  replyId?: string;
  /** 이 댓글에 이미 단 내 답 같은, 카드에서 뺄 id */
  excludeIds?: string[];
}

// 댓글마다 한 번만 만든다 (서버가 살아 있는 동안). 같은 댓글을 동시에 열어도 호출은 하나.
const CACHE_MAX = 500;
function cache(): Map<string, Promise<Stance>> {
  const g = globalThis as typeof globalThis & { __threadsStanceCache?: Map<string, Promise<Stance>> };
  g.__threadsStanceCache ??= new Map();
  return g.__threadsStanceCache;
}

async function summarize(ownerName: string, commentText: string, hits: KnowledgeHit[], items: StanceItem[]) {
  const timeoutMs = stanceTimeoutMs();
  const raw = await generateText({
    tier: "fast",
    json: true,
    prompt: buildStancePrompt({ ownerName, commentText, hits, items }),
    timeoutMs,
    deadlineMs: Date.now() + timeoutMs + 15_000,
  });
  return normalizeStance(raw, items.length);
}

async function buildStance(input: StanceInput): Promise<{ stance: Stance; cacheable: boolean }> {
  const persona = await readPersona(input.personaId);
  const query = input.commentText.trim() || input.postText.trim();
  const terms = knowledgeTerms(query);
  const weights = (await termWeights(persona.id, terms)) ?? undefined;
  const find = retrievalTerms(terms, weights);
  const [replies, posts] = await Promise.all([
    searchPastReplies(persona.id, query, 12, { learnOnly: true, terms: find }),
    searchPosts(persona.id, query, 6, { terms: find }),
  ]);
  const source: KnowledgeSource = replies.source === "supabase" && posts.source === "supabase" ? "supabase" : "local";
  const hits = pickStanceHits(replies.hits, posts.hits, terms, { excludeIds: input.excludeIds, weights });
  const items = toStanceItems(hits, terms);
  const topic = fallbackTopic(terms);
  if (items.length < STANCE_MIN_ITEMS) return { stance: { topic, summary: "", items, source }, cacheable: true };
  try {
    const out = await summarize(persona.ownerName, input.commentText, hits, items);
    return { stance: { topic: out.topic || topic, summary: out.summary, items, source }, cacheable: true };
  } catch (error) {
    console.warn("[stance] 요약 실패 — 항목만 돌려줌:", error instanceof Error ? error.message : error);
    return { stance: { topic, summary: "", items, source }, cacheable: false };
  }
}

export async function stanceFor(input: StanceInput): Promise<Stance> {
  const key = input.replyId ? `${input.personaId}:${input.replyId}` : null;
  const hit = key ? cache().get(key) : undefined;
  if (hit) return hit;
  const run = buildStance(input).then(({ stance, cacheable }) => {
    if (key && !cacheable) cache().delete(key); // 요약 실패는 다음에 다시 시도
    return stance;
  });
  if (key) {
    cache().set(key, run);
    run.catch(() => cache().delete(key));
    if (cache().size > CACHE_MAX) cache().delete(cache().keys().next().value as string);
  }
  return run;
}
