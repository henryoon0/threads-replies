// 초안 전에 찾는 "예전에 한 말" — 같은 주제로 주인이 단 답 + 지금 댓글 단 사람에게 했던 답.
//
// 이 앱은 주인이 보낸 답이 원장(myReply)에 쌓인다. 그 안에서 찾는다 (외부 검색 없음).
//   같은 사람: 지금 댓글 단 사람에게 했던 답, 최신 순.
//   같은 주제: 받은 댓글·내 답이 지금 댓글과 낱말이 겹치는 답, 겹친 낱말 수 → 글자 닮음 → 최신 순.
// 찾은 답은 초안 프롬프트의 <owner_past_replies> 와 어긋남 검사(consistency.ts)가 함께 쓴다.
//
// Pure — I/O 없음.

import { textSimilarity } from "@/lib/text-similarity";
import { koreanTerms, nameTokens } from "./fact-check";
import type { PastSaid, ThreadsRepliesLedger, ThreadsReply } from "./model";

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

/** 감사·응원처럼 내용 없는 답은 비교할 게 없다. */
export function hasSubstance(text: string): boolean {
  const core = text.replace(/[ㄱ-ㅎㅏ-ㅣ]|[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  if (Array.from(core).length < 8) return false;
  return !/^(감사|고맙|좋은\s?글|축하|화이팅|응원)/.test(core);
}

type Answered = ThreadsReply & { myReply: NonNullable<ThreadsReply["myReply"]> };

function answered(ledger: Pick<ThreadsRepliesLedger, "replies">, reply: Pick<ThreadsReply, "id">): Answered[] {
  return ledger.replies.filter(
    (r): r is Answered => r.id !== reply.id && Boolean(r.myReply?.text?.trim()) && hasSubstance(r.myReply!.text)
  );
}

function toPast(r: Answered, sameCommenter: boolean): PastSaid {
  const date = dateOf(r.myReply.timestamp);
  return {
    id: r.myReply.id,
    text: clip(r.myReply.text),
    comment: r.text,
    ...(date ? { date } : {}),
    ...(sameCommenter ? { sameCommenter: true } : {}),
  };
}

/** 같은 사람에게 했던 답 (원장의 myReply). 최신 순. */
export function sameCommenterPast(
  ledger: Pick<ThreadsRepliesLedger, "replies">,
  reply: Pick<ThreadsReply, "id" | "username">,
  max = PAST_SAME_PERSON_MAX
): PastSaid[] {
  return answered(ledger, reply)
    .filter((r) => r.username === reply.username)
    .sort((a, b) => b.myReply.timestamp.localeCompare(a.myReply.timestamp))
    .slice(0, max)
    .map((r) => toPast(r, true));
}

function terms(text: string): string[] {
  return [...koreanTerms(text), ...nameTokens(text)];
}

/** 겹친 낱말 수 기준: 낱말이 적은 댓글은 1개, 많으면 2개 이상 겹쳐야 같은 주제로 본다. */
export function relevanceFloor(termCount: number): number {
  return termCount <= 3 ? 1 : 2;
}

/** 같은 주제로 했던 답. 낱말이 없으면 빈 목록. */
export function topicPast(
  ledger: Pick<ThreadsRepliesLedger, "replies">,
  reply: Pick<ThreadsReply, "id" | "text">,
  opts: { excludeIds?: readonly string[]; max?: number } = {}
): PastSaid[] {
  const want = terms(reply.text);
  if (!want.length) return [];
  const floor = relevanceFloor(want.length);
  const skip = new Set(opts.excludeIds ?? []);
  const seen = new Set<string>();
  return answered(ledger, reply)
    .filter((r) => !skip.has(r.myReply.id))
    .map((r) => {
      const hay = `${r.text}\n${r.myReply.text}`.toLowerCase();
      return { r, m: want.filter((t) => hay.includes(t)).length, sim: textSimilarity(reply.text, r.text) };
    })
    .filter((x) => x.m >= floor)
    .sort((a, b) => b.m - a.m || b.sim - a.sim || b.r.myReply.timestamp.localeCompare(a.r.myReply.timestamp))
    .filter((x) => {
      const key = x.r.myReply.text.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, opts.max ?? PAST_TOPIC_MAX)
    .map((x) => toPast(x.r, false));
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

/** 댓글 하나의 "예전에 한 말". */
export function pastSaidFor(ledger: Pick<ThreadsRepliesLedger, "replies">, reply: ThreadsReply): PastSaid[] {
  const same = sameCommenterPast(ledger, reply);
  const exclude = [...(reply.myReply ? [reply.myReply.id] : []), ...same.map((p) => p.id)];
  return mergePast(same, topicPast(ledger, reply, { excludeIds: exclude }));
}
