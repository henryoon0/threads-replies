// 스레드 댓글 동기화: 최근 글 → 대화 트리 → 원장 병합. 읽기 전용 API 만 쓴다.
// 병합(mergeConversations)은 Pure 라 테스트로 고정하고, syncReplies 가 I/O 를 맡는다.
import { isRateLimited, isTokenExpired } from "@/lib/threads-archive/graph";
import { classifyIntent } from "./intent";
import { fetchConversation, listRecentPosts, readyToken, type RawConversationReply } from "./graph";
import type { ThreadsPostRef, ThreadsRepliesLedger, ThreadsReply } from "./model";
import { readRepliesLedger, updateRepliesLedger } from "./storage";

export const SYNC_STALE_MS = 10 * 60 * 1000;
const DEFAULT_POSTS = 20;
const FETCH_CONCURRENCY = 4;

export interface FetchedConversation {
  post: ThreadsPostRef;
  replies: RawConversationReply[];
}

function byTimeDesc(a: { timestamp: string }, b: { timestamp: string }): number {
  return Date.parse(b.timestamp) - Date.parse(a.timestamp);
}

function repliesOfPost(post: ThreadsPostRef, raw: RawConversationReply[], prev: Map<string, ThreadsReply>): ThreadsReply[] {
  const mine = raw.filter((r) => r.is_reply_owned_by_me);
  const myById = new Map(mine.map((r) => [r.id, r]));
  // 댓글 하나에 내가 여러 번 답했으면 가장 먼저 단 답을 myReply 로 둔다.
  const myByParent = new Map<string, RawConversationReply>();
  for (const r of [...mine].sort((a, b) => Date.parse(a.timestamp ?? "") - Date.parse(b.timestamp ?? ""))) {
    const parent = r.replied_to?.id;
    if (parent && !myByParent.has(parent)) myByParent.set(parent, r);
  }
  return raw
    .filter((r) => !r.is_reply_owned_by_me)
    .map((r) => {
      const repliedToId = r.replied_to?.id ?? post.id;
      const parentMine = myById.get(repliedToId);
      // 내 이어쓰기 칸(원글에 바로 단 내 답)에 단 말은 원글 댓글과 같다. 남의 댓글에 단 내 답에 온 말만 대화 줄기.
      const isReplyToMyReply = !!parentMine && parentMine.replied_to?.id !== post.id;
      const text = r.text ?? "";
      const old = prev.get(r.id);
      const mineReply = myByParent.get(r.id);
      const next: ThreadsReply = {
        id: r.id,
        postId: post.id,
        username: r.username ?? "(알 수 없음)",
        text,
        timestamp: r.timestamp ?? "",
        repliedToId,
        intent: classifyIntent(text, isReplyToMyReply),
      };
      if (parentMine?.text) next.repliedToText = parentMine.text;
      if (mineReply) next.myReply = { id: mineReply.id, text: mineReply.text ?? "", timestamp: mineReply.timestamp ?? "" };
      if (old?.skipped) next.skipped = true;
      if (old?.answer) next.answer = old.answer;
      return next;
    });
}

/**
 * 가져온 대화들을 원장에 합친다. 가져온 글의 댓글은 새 목록으로 바꾸고(지워진 댓글은 빠진다),
 * 못 가져온 글의 댓글은 그대로 둔다. skipped·answer 는 이어받는다.
 */
export function mergeConversations(
  ledger: ThreadsRepliesLedger,
  fetched: FetchedConversation[],
  nowIso: string
): ThreadsRepliesLedger {
  const prev = new Map(ledger.replies.map((r) => [r.id, r]));
  const fetchedIds = new Set(fetched.map((f) => f.post.id));
  const posts = new Map(ledger.posts.map((p) => [p.id, p]));
  for (const f of fetched) posts.set(f.post.id, f.post);
  const replies = [
    ...ledger.replies.filter((r) => !fetchedIds.has(r.postId)),
    ...fetched.flatMap((f) => repliesOfPost(f.post, f.replies, prev)),
  ].sort(byTimeDesc);
  return {
    posts: [...posts.values()].sort(byTimeDesc),
    replies,
    sync: { ...ledger.sync, lastSyncAt: nowIso, postsScanned: fetched.length },
  };
}

export function isStale(ledger: ThreadsRepliesLedger, nowMs = Date.now()): boolean {
  if (!ledger.sync.lastSyncAt) return true;
  return nowMs - Date.parse(ledger.sync.lastSyncAt) > SYNC_STALE_MS;
}

async function fetchAll(
  posts: ThreadsPostRef[],
  token: string
): Promise<{ fetched: FetchedConversation[]; errors: string[] }> {
  const fetched: FetchedConversation[] = [];
  const errors: string[] = [];
  let stop = false;
  let cursor = 0;
  const worker = async () => {
    while (!stop && cursor < posts.length) {
      const post = posts[cursor++];
      try {
        fetched.push({ post, replies: await fetchConversation(post.id, token) });
      } catch (error) {
        if (isRateLimited(error) || isTokenExpired(error)) stop = true;
        errors.push(`${post.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  return { fetched, errors };
}

async function runSync(postLimit: number): Promise<ThreadsRepliesLedger> {
  try {
    const token = await readyToken();
    const raw = await listRecentPosts(postLimit, token);
    const posts: ThreadsPostRef[] = raw.map((p) => ({
      id: p.id,
      text: p.text ?? "",
      permalink: p.permalink,
      timestamp: p.timestamp ?? "",
    }));
    const { fetched, errors } = await fetchAll(posts, token);
    return await updateRepliesLedger((ledger) => {
      const next = mergeConversations(ledger, fetched, new Date().toISOString());
      next.sync.lastError = errors.length ? `대화 ${errors.length}건 못 읽음 · ${errors[0]}` : undefined;
      return next;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return updateRepliesLedger((ledger) => ({ ...ledger, sync: { ...ledger.sync, lastError: message } }));
  }
}

/** 실동기화. 이미 도는 동기화가 있으면 그 결과를 같이 기다린다. 실패는 원장 sync.lastError 로 남는다. */
export async function syncReplies(opts: { posts?: number } = {}): Promise<ThreadsRepliesLedger> {
  const g = globalThis as typeof globalThis & { __threadsRepliesSync?: Promise<ThreadsRepliesLedger> };
  if (g.__threadsRepliesSync) return g.__threadsRepliesSync;
  const run = runSync(opts.posts ?? DEFAULT_POSTS).finally(() => {
    g.__threadsRepliesSync = undefined;
  });
  g.__threadsRepliesSync = run;
  return run;
}

/** 10분 넘게 지났으면 동기화, 아니면 저장된 원장 그대로. */
export async function syncIfStale(): Promise<ThreadsRepliesLedger> {
  const ledger = await readRepliesLedger();
  return isStale(ledger) ? syncReplies() : ledger;
}
