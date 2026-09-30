// 비슷한 맥락에서 남긴 글 (henry 09-29 요청 5): 지금 댓글과 비슷한 댓글에 주인이 예전에 단 답.
//
// "예전에 한 말"(past-said.ts)과 같은 검색을 쓰되, 제품 권유가 든 답(learn=false)도 넣고 "제품" 표시를 붙인다.
// 말투 학습에는 안 쓰지만, 주인이 답을 쓸 때 "그때 뭘 추천했더라"를 옆에서 보는 용도라 필요하다.
//
// 관련 없으면 띄우지 않는다 (henry 09-29). 낱말 문턱을 넘은 답과 검색 상위 답을 후보로 모으고,
// 같은 사람에게 한 답까지 전부 관련성 게이트(similar-gate.ts)가 한 번에 판정한다. 빈 칸 채우기·제품 답 강제 채우기는 없앴다.

import { knowledgeTerms, learnBlockReason, retrievalTerms } from "@/lib/personas/knowledge/rows";
import { termWeights } from "@/lib/personas/knowledge/sources";
import { searchPastReplies } from "@/lib/personas/knowledge/supabase";
import type { KnowledgeHit } from "@/lib/personas/knowledge/rows";
import type { PastSaid, ThreadsRepliesLedger, ThreadsReply } from "./model";
import { mergePast, pickTopicPast, sameCommenterPast } from "./past-said";
import { gateRelevant } from "./similar-gate";

export interface SimilarItem extends PastSaid {
  /** 제품·브랜드·처방약 이름이 든 답 (학습 제외 답) */
  product: boolean;
}

export const SIMILAR_MAX = 8;
/** 게이트에 보낼 후보 수 상한 (같은 사람 답 + 주제 답 + 검색 상위 답) */
export const SIMILAR_CANDIDATES = 14;

/** 제품 권유가 든 답인가 (처방약·용량은 제외 — 옆에 띄워 둘 이유가 없다). */
export function isProductReply(text: string): boolean {
  return learnBlockReason(text) === "제품·브랜드";
}

/** 같은 사람 → 주제 순으로 합치고 제품 표시를 붙인다. */
export function composeSimilar(same: readonly PastSaid[], topic: readonly PastSaid[], max = SIMILAR_MAX): SimilarItem[] {
  return mergePast(same, topic)
    .slice(0, max)
    .map((p) => ({ ...p, product: isProductReply(p.text) }));
}

/** 관련도 문턱을 못 넘은 검색 결과도 검색 순서대로 후보에 넣는다 (게이트가 거른다) */
export function looseFill(hits: readonly KnowledgeHit[], exclude: readonly string[], n: number): PastSaid[] {
  if (n <= 0) return [];
  const skip = new Set(exclude);
  return hits
    .filter((h) => h.kind === "reply" && !skip.has(h.id) && h.body.trim().length >= 15)
    .slice(0, n)
    .map((h) => ({
      id: h.id,
      text: h.body.trim().slice(0, 600),
      ...(h.commentBody ? { comment: h.commentBody } : {}),
      ...(h.postedAt && /^\d{4}-\d{2}-\d{2}/.test(h.postedAt) ? { date: h.postedAt.slice(0, 10) } : {}),
      ...(h.permalink ? { permalink: h.permalink } : {}),
    }));
}

const squash = (s: string) => s.replace(/\s+/g, "");

/** 지금 이 댓글에 이미 단 답(같은 댓글 글)은 "비슷한 글"이 아니다 */
export function withoutSelf(items: readonly PastSaid[], reply: Pick<ThreadsReply, "text">): PastSaid[] {
  const me = squash(reply.text);
  return items.filter((p) => !p.comment || squash(p.comment) !== me);
}

async function topicCandidates(personaId: string, reply: ThreadsReply, exclude: readonly string[], room: number): Promise<PastSaid[]> {
  const query = reply.text.trim();
  const terms = knowledgeTerms(query);
  if (!terms.length || room <= 0) return [];
  try {
    const weights = (await termWeights(personaId, terms)) ?? undefined;
    const found = await searchPastReplies(personaId, query, 30, { terms: retrievalTerms(terms, weights) });
    const strict = pickTopicPast(found.hits, terms, { excludeIds: exclude, weights, max: room });
    return [...strict, ...looseFill(found.hits, [...exclude, ...strict.map((p) => p.id)], room - strict.length)];
  } catch (error) {
    console.warn("[similar] 비슷한 답 검색 실패:", error instanceof Error ? error.message : error);
    return [];
  }
}

/** 댓글 하나의 비슷한 예전 답. 관련성 게이트를 통과한 것만. 없으면 빈 목록. */
export async function similarFor(personaId: string, ledger: Pick<ThreadsRepliesLedger, "replies">, reply: ThreadsReply, max = SIMILAR_MAX): Promise<SimilarItem[]> {
  const same = sameCommenterPast(ledger, reply);
  const exclude = [...(reply.myReply ? [reply.myReply.id] : []), ...same.map((p) => p.id)];
  const topic = await topicCandidates(personaId, reply, exclude, SIMILAR_CANDIDATES - same.length);
  const candidates = withoutSelf(mergePast(same, topic), reply);
  const kept = await gateRelevant(reply.text.trim(), candidates);
  return composeSimilar(kept.filter((p) => p.sameCommenter), kept.filter((p) => !p.sameCommenter), max);
}
