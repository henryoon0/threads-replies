// 토큰 없는 페르소나(박약사)의 받은함 — aside 로 모아 둔 댓글 파일을 원장 모양으로 옮긴다.
//
// 파일: data/domains/wellness/threads-comments/glp1-pharmacy-*.json (aside repl 네트워크 가로채기, 09-27 수집)
//   { source: 글 주소, collectedAt, comments: [{ q: { user, text, likes, at(초) }, answers: [약사 답…], more }] }
// 토큰이 들어오면 sync.ts 가 Threads API 로 바꿔 탄다. 이 경로는 읽기 전용 받은함이다.
// 원장에 이미 있는 댓글의 초안·건너뛰기·보낸 답은 이어받는다(가져오기를 여러 번 해도 같은 결과).

import { readFile } from "fs/promises";
import { classifyIntent } from "./intent";
import type { ThreadsPostRef, ThreadsRepliesLedger, ThreadsReply } from "./model";

export interface CollectedComment {
  /** code = 이 댓글 자체의 스레드 글 코드 (있으면 댓글로 바로 가는 주소를 만든다) */
  q?: { user?: string; text?: string; likes?: number; at?: number; code?: string };
  answers?: unknown[];
}

export interface CollectedFile {
  source?: string;
  collectedAt?: string;
  comments?: CollectedComment[];
}

/** 박약사 AMA 글 본문 발췌 (전문은 저장돼 있지 않다 — data/content-ideas-records/manual-2026-09-27-ama-1.json 의 sourceQuote). */
const POST_EXCERPTS: Record<string, string> = {
  DdvdAKek5at: "다여트주사 궁금한거 다 물어봐. … 뭐 그거말고도 뭐 영양제 비타민 이런것도 던져봐. 답해줄께.",
};

export function postIdFromSource(source: string | undefined): string {
  const m = /\/post\/([A-Za-z0-9_-]+)/.exec(source ?? "");
  return m?.[1] ?? "collected";
}

function iso(at: number | undefined, fallback: string): string {
  return typeof at === "number" && Number.isFinite(at) ? new Date(at * 1000).toISOString() : fallback;
}

function earliestAt(comments: readonly CollectedComment[]): number | undefined {
  let min: number | undefined;
  for (const c of comments) {
    const at = c.q?.at;
    if (typeof at === "number" && (min === undefined || at < min)) min = at;
  }
  return min;
}

function firstAnswer(c: CollectedComment): string | undefined {
  const a = (c.answers ?? []).find((x): x is string => typeof x === "string" && x.trim().length > 0);
  return a?.trim();
}

/** 수집 댓글의 q 를 빈 값 없는 모양으로 편다. */
function questionOf(c: CollectedComment): { text: string; user: string; at: number | undefined; code?: string } {
  const q = c.q ?? {};
  const code = typeof q.code === "string" && /^[A-Za-z0-9_-]+$/.test(q.code) ? q.code : undefined;
  return { text: (q.text ?? "").trim(), user: (q.user ?? "").trim(), at: q.at, ...(code ? { code } : {}) };
}

/** 댓글 자체의 스레드 주소. 스레드는 댓글도 "@단 사람/post/코드" 로 열린다. */
export function commentPermalink(user: string, code: string | undefined): string | undefined {
  return code ? `https://www.threads.com/@${encodeURIComponent(user)}/post/${code}` : undefined;
}

export function collectedReplyId(c: CollectedComment): string {
  const q = questionOf(c);
  return `aside-${q.at ?? 0}-${q.user}`;
}

/** 원장에 있던 초안·건너뛰기·대시보드에서 단 답을 이어받는다. */
function inherit(next: ThreadsReply, before: ThreadsReply | undefined): void {
  if (!before) return;
  if (!next.myReply && before.myReply) next.myReply = before.myReply;
  if (before.skipped) next.skipped = true;
  if (before.answer) next.answer = before.answer;
}

/** 수집 댓글 하나 → 원장 댓글. */
function replyFromCollected(c: CollectedComment, postId: string, collectedAt: string, before: ThreadsReply | undefined): ThreadsReply | null {
  const q = questionOf(c);
  if (!q.text || !q.user) return null;
  const id = collectedReplyId(c);
  const timestamp = iso(q.at, collectedAt);
  const permalink = commentPermalink(q.user, q.code);
  const next: ThreadsReply = { id, postId, username: q.user, text: q.text, timestamp, ...(permalink ? { permalink } : {}), repliedToId: postId, intent: classifyIntent(q.text, false) };
  const answer = firstAnswer(c);
  if (answer) next.myReply = { id: `${id}-answer`, text: answer, timestamp };
  inherit(next, before);
  return next;
}

/** 수집 파일 → 원장. prev 의 answer·skipped·myReply(대시보드에서 단 답)는 이어받는다. Pure. */
export function ledgerFromCollected(file: CollectedFile, prev: ThreadsRepliesLedger, nowIso: string): ThreadsRepliesLedger {
  const postId = postIdFromSource(file.source);
  const collectedAt = file.collectedAt ? `${file.collectedAt}T00:00:00.000Z` : nowIso;
  const comments = file.comments ?? [];
  const post: ThreadsPostRef = {
    id: postId,
    text: POST_EXCERPTS[postId] ?? "",
    permalink: file.source,
    timestamp: iso(earliestAt(comments), collectedAt),
  };
  const old = new Map(prev.replies.map((r) => [r.id, r]));
  const replies = comments
    .map((c) => replyFromCollected(c, postId, collectedAt, old.get(collectedReplyId(c))))
    .filter((r): r is ThreadsReply => r !== null);
  return {
    posts: [post, ...prev.posts.filter((p) => p.id !== postId)],
    replies: [...replies, ...prev.replies.filter((r) => r.postId !== postId)],
    sync: { lastSyncAt: nowIso, postsScanned: 1, source: "collected" },
  };
}

export async function readCollectedFile(absPath: string): Promise<CollectedFile> {
  return JSON.parse(await readFile(absPath, "utf8")) as CollectedFile;
}
