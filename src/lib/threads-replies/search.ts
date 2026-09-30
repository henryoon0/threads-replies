// 스레드 계정 검색 (henry 09-29 요청 4): 이 계정의 댓글 · 내 글 · 내가 예전에 단 답을 한 번에 찾는다.
//
// 사람이 기억나는 말로 찾는 검색이라 낱말이 모두 들어간 것(AND, 부분 일치)부터 보여준다.
// 예전 답이 한 건도 안 걸리면 지식 검색(searchPastReplies, 낱말 무게)으로 한 번 더 찾는다.
// 위쪽은 순수, 맨 아래 searchAccount 만 I/O 다.

import { readLocalKnowledgeCached } from "@/lib/personas/knowledge/sources";
import { searchPastReplies } from "@/lib/personas/knowledge/supabase";
import type { MyReplyRow, PostRow } from "@/lib/personas/knowledge/rows";
import type { ThreadsRepliesLedger } from "./model";

export type AccountHitKind = "comment" | "post" | "past";

export interface AccountHit {
  kind: AccountHitKind;
  id: string;
  /** 댓글 글 · 내 글 · 내가 단 답 */
  text: string;
  /** 댓글이면 단 사람 아이디, 예전 답이면 그 답이 달린 댓글 */
  sub?: string;
  date?: string;
  permalink?: string;
  /** 댓글: 이미 답했나 · 건너뛰었나 */
  state?: "open" | "answered" | "skipped";
  /** 댓글에 내가 단 답 (있으면) */
  myReply?: string;
}

export interface AccountSearchResult {
  query: string;
  comments: AccountHit[];
  posts: AccountHit[];
  past: AccountHit[];
}

const TEXT_CHARS = 400;

function norm(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/\s+/g, " ");
}

/** 검색어를 낱말로 자른다 (NFC · 소문자 · 빈칸 기준). */
export function queryTokens(query: string): string[] {
  return [...new Set(norm(query).split(" ").map((t) => t.trim()).filter(Boolean))].slice(0, 6);
}

/** 낱말이 모두 들어 있으면 점수(나온 횟수 합), 하나라도 없으면 0. */
export function matchScore(text: string, tokens: readonly string[]): number {
  if (!tokens.length) return 0;
  const t = norm(text);
  let score = 0;
  for (const tok of tokens) {
    const n = t.split(tok).length - 1;
    if (!n) return 0;
    score += n;
  }
  return score;
}

function clip(text: string): string {
  const t = text.trim();
  return t.length > TEXT_CHARS ? `${t.slice(0, TEXT_CHARS)}…` : t;
}

function day(iso: string | null | undefined): string | undefined {
  return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : undefined;
}

type Scored = { hit: AccountHit; score: number };

function top(items: Scored[], limit: number): AccountHit[] {
  return items
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.hit.date ?? "").localeCompare(a.hit.date ?? ""))
    .slice(0, limit)
    .map((x) => x.hit);
}

/** 원장의 댓글 (댓글 글 · 단 사람 · 내 답 어느 쪽이 맞아도 걸린다). 댓글 자체 주소가 있으면 그것, 없으면 달린 글 주소. */
export function searchComments(ledger: Pick<ThreadsRepliesLedger, "replies"> & { posts?: ThreadsRepliesLedger["posts"] }, tokens: readonly string[], limit = 8): AccountHit[] {
  const postLink = new Map((ledger.posts ?? []).flatMap((p) => (p.permalink ? [[p.id, p.permalink] as const] : [])));
  return top(
    ledger.replies.map((r) => ({
      score: matchScore(`${r.username} ${r.text} ${r.myReply?.text ?? ""}`, tokens),
      hit: {
        kind: "comment" as const,
        id: r.id,
        text: clip(r.text),
        sub: r.username,
        date: day(r.timestamp),
        state: r.myReply ? ("answered" as const) : r.skipped ? ("skipped" as const) : ("open" as const),
        ...(r.myReply ? { myReply: clip(r.myReply.text) } : {}),
        ...((r.permalink ?? postLink.get(r.postId)) ? { permalink: r.permalink ?? postLink.get(r.postId) } : {}),
      },
    })),
    limit
  );
}

/** 내 글: 원장에 걸린 글 + 보관함 글 (같은 id 는 한 번만). */
export function searchPostsIn(ledgerPosts: ThreadsRepliesLedger["posts"], archive: readonly PostRow[], tokens: readonly string[], limit = 5): AccountHit[] {
  const seen = new Set<string>();
  const all: Scored[] = [];
  for (const p of ledgerPosts) {
    seen.add(p.id);
    all.push({ score: matchScore(p.text, tokens), hit: { kind: "post", id: p.id, text: clip(p.text), date: day(p.timestamp), permalink: p.permalink } });
  }
  for (const p of archive) {
    if (seen.has(p.id)) continue;
    all.push({ score: matchScore(p.body, tokens), hit: { kind: "post", id: p.id, text: clip(p.body), date: day(p.posted_at), permalink: p.permalink ?? undefined } });
  }
  return top(all, limit);
}

/** 내가 예전에 단 답 (답 본문 · 받은 댓글 어느 쪽이 맞아도). */
export function searchPastRows(rows: readonly MyReplyRow[], tokens: readonly string[], limit = 8): AccountHit[] {
  return top(
    rows.map((r) => ({
      score: matchScore(`${r.body} ${r.comment_body ?? ""}`, tokens),
      hit: {
        kind: "past" as const,
        id: r.id,
        text: clip(r.body),
        ...(r.comment_body ? { sub: clip(r.comment_body) } : {}),
        date: day(r.posted_at),
        permalink: r.permalink ?? undefined,
      },
    })),
    limit
  );
}

/** 이 계정 전체에서 찾기. 지식 검색이 실패해도 원장 결과는 돌려준다. */
export async function searchAccount(personaId: string, ledger: ThreadsRepliesLedger, query: string, limit = 8): Promise<AccountSearchResult> {
  const tokens = queryTokens(query);
  const empty = { query, comments: [], posts: [], past: [] };
  if (!tokens.length) return empty;
  const local = await readLocalKnowledgeCached(personaId).catch(() => ({ personaId, posts: [] as PostRow[], replies: [] as MyReplyRow[] }));
  const comments = searchComments(ledger, tokens, limit);
  const posts = searchPostsIn(ledger.posts, local.posts, tokens, 5);
  let past = searchPastRows(local.replies, tokens, limit);
  if (!past.length) {
    const found = await searchPastReplies(personaId, query, limit).catch(() => null);
    past = (found?.hits ?? []).map((h) => ({
      kind: "past" as const,
      id: h.id,
      text: clip(h.body),
      ...(h.commentBody ? { sub: clip(h.commentBody) } : {}),
      date: day(h.postedAt),
      permalink: h.permalink,
    }));
  }
  return { query, comments, posts, past };
}
