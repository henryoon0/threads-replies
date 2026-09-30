// 초안 전에 찾는 "예전에 한 말" — 같은 주제로 주인이 단 답 + 지금 댓글 단 사람에게 했던 답.
//
// 입장 카드(stance.ts)와 같은 검색을 쓰되, 학습 제외 답(learn=false: 처방약·제품 권유)도 넣는다.
// 말투 예시로는 안 쓰지만 "예전에 이렇게 말했다"는 일관성 비교 대상이기 때문이다.
// 찾은 답은 초안 프롬프트의 <owner_past_replies> 와 어긋남 검사(consistency.ts)가 함께 쓴다.

import { knowledgeTerms, matchedTermCount, retrievalTerms, weightedMatch, type KnowledgeHit } from "@/lib/personas/knowledge/rows";
import { termWeights } from "@/lib/personas/knowledge/sources";
import { searchPastReplies } from "@/lib/personas/knowledge/supabase";
import type { PastSaid, ThreadsRepliesLedger, ThreadsReply } from "./model";
import { hasSubstance, relevanceFloor, WEIGHT_SHARE_FLOOR } from "./stance";

export const PAST_TOPIC_MAX = 5;
export const PAST_SAME_PERSON_MAX = 3;
const PAST_TEXT_CHARS = 600;

function clip(text: string): string {
  const t = text.trim();
  return t.length > PAST_TEXT_CHARS ? `${t.slice(0, PAST_TEXT_CHARS)}…` : t;
}

function dateOf(iso: string | undefined): string | undefined {
  return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : undefined;
}

/** 같은 사람에게 했던 답 (원장의 myReply). 최신 순. */
export function sameCommenterPast(ledger: Pick<ThreadsRepliesLedger, "replies">, reply: Pick<ThreadsReply, "id" | "username">, max = PAST_SAME_PERSON_MAX): PastSaid[] {
  return ledger.replies
    .filter((r) => r.id !== reply.id && r.username === reply.username && r.myReply?.text?.trim() && hasSubstance(r.myReply.text))
    .sort((a, b) => (b.myReply?.timestamp ?? "").localeCompare(a.myReply?.timestamp ?? ""))
    .slice(0, max)
    .map((r) => ({
      id: r.myReply!.id,
      text: clip(r.myReply!.text),
      comment: r.text,
      ...(dateOf(r.myReply!.timestamp) ? { date: dateOf(r.myReply!.timestamp) } : {}),
      sameCommenter: true,
    }));
}

/** 주제 검색 결과 고르기: 내용 없는 답·제외 id·관련 약한 답을 빼고 무게 → 걸린 낱말 수 → 최신 순. */
export function pickTopicPast(
  hits: readonly KnowledgeHit[],
  terms: readonly string[],
  opts: { excludeIds?: readonly string[]; weights?: ReadonlyMap<string, number>; max?: number } = {}
): PastSaid[] {
  const floor = relevanceFloor(terms.length);
  let total = 0;
  for (const w of opts.weights?.values() ?? []) total += w;
  const minWeight = opts.weights ? total * WEIGHT_SHARE_FLOOR : 0;
  const skip = new Set(opts.excludeIds ?? []);
  const seen = new Set<string>();
  return hits
    .filter((h) => h.kind === "reply" && !skip.has(h.id) && hasSubstance(h.body))
    .map((h) => ({ h, m: matchedTermCount(h, terms), w: weightedMatch(h, terms, opts.weights) }))
    .filter((x) => x.m >= floor && x.w >= minWeight)
    .sort((a, b) => b.w - a.w || b.m - a.m || (b.h.postedAt ?? "").localeCompare(a.h.postedAt ?? ""))
    .filter((x) => {
      const key = x.h.body.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, opts.max ?? PAST_TOPIC_MAX)
    .map(({ h }) => ({
      id: h.id,
      text: clip(h.body),
      ...(h.commentBody ? { comment: h.commentBody } : {}),
      ...(dateOf(h.postedAt) ? { date: dateOf(h.postedAt) } : {}),
      ...(h.permalink ? { permalink: h.permalink } : {}),
    }));
}

/** 같은 사람 답을 앞에, 주제 답을 뒤에. 같은 답은 한 번만. */
export function mergePast(samePerson: readonly PastSaid[], topic: readonly PastSaid[]): PastSaid[] {
  const out: PastSaid[] = [];
  const ids = new Set<string>();
  for (const p of [...samePerson, ...topic]) {
    if (ids.has(p.id) || out.some((o) => o.text === p.text)) continue;
    ids.add(p.id);
    out.push(p);
  }
  return out;
}

/** 댓글 하나의 "예전에 한 말". 검색이 실패해도 같은 사람 답만으로 돌려준다 (초안은 멈추지 않는다). */
export async function pastSaidFor(personaId: string, ledger: Pick<ThreadsRepliesLedger, "replies">, reply: ThreadsReply): Promise<PastSaid[]> {
  const same = sameCommenterPast(ledger, reply);
  const query = reply.text.trim();
  const terms = knowledgeTerms(query);
  if (!terms.length) return same;
  try {
    const weights = (await termWeights(personaId, terms)) ?? undefined;
    const found = await searchPastReplies(personaId, query, 16, { terms: retrievalTerms(terms, weights) });
    const exclude = [...(reply.myReply ? [reply.myReply.id] : []), ...same.map((p) => p.id)];
    return mergePast(same, pickTopicPast(found.hits, terms, { excludeIds: exclude, weights }));
  } catch (error) {
    console.warn("[past-said] 예전 답 검색 실패:", error instanceof Error ? error.message : error);
    return same;
  }
}
