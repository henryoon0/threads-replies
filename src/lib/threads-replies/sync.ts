// 스레드 댓글 동기화: 최근 글 → 대화 트리 → 원장 병합. 읽기 전용 API 만 쓴다.
// 병합(mergeConversations)은 Pure 라 테스트로 고정하고, syncReplies 가 I/O 를 맡는다.
import { isRateLimited, isTokenExpired } from "@/lib/threads-archive/graph";
import { currentPersona } from "@/lib/personas/context";
import { hasPersonaToken, repoPath } from "@/lib/personas/registry";
import { ledgerFromCollected, readCollectedFile } from "./collected";
import { classifyIntent } from "./intent";
import { fetchConversation, listRecentPosts, readyToken, type RawConversationReply } from "./graph";
import type { ThreadsPostRef, ThreadsRepliesLedger, ThreadsReply } from "./model";
import { ledgerPath, readRepliesLedger, updateRepliesLedger } from "./storage";

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
      const next = baseReply(r, post.id, repliedToId, isReplyToMyReply);
      attachKnown(next, parentMine, myByParent.get(r.id), prev.get(r.id));
      return next;
    });
}

function baseReply(r: RawConversationReply, postId: string, repliedToId: string, isReplyToMyReply: boolean): ThreadsReply {
  const text = r.text ?? "";
  return {
    id: r.id,
    postId,
    username: r.username ?? "(알 수 없음)",
    text,
    timestamp: r.timestamp ?? "",
    repliedToId,
    intent: classifyIntent(text, isReplyToMyReply),
  };
}

/** 내 답(위 칸·이 댓글에 단 답)과 원장에 있던 건너뛰기·초안을 붙인다. */
function attachKnown(
  next: ThreadsReply,
  parentMine: RawConversationReply | undefined,
  mineReply: RawConversationReply | undefined,
  old: ThreadsReply | undefined
): void {
  if (parentMine?.text) next.repliedToText = parentMine.text;
  if (mineReply) next.myReply = { id: mineReply.id, text: mineReply.text ?? "", timestamp: mineReply.timestamp ?? "" };
  if (old?.skipped) next.skipped = true;
  if (old?.answer) next.answer = old.answer;
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

/** 토큰 없는 페르소나: aside 수집본으로 받은함을 채운다 (읽기 전용). */
async function importCollected(rel: string): Promise<ThreadsRepliesLedger> {
  const file = await readCollectedFile(repoPath(rel));
  return updateRepliesLedger((ledger) => ledgerFromCollected(file, ledger, new Date().toISOString()));
}

async function runSync(postLimit: number): Promise<ThreadsRepliesLedger> {
  const persona = currentPersona();
  try {
    if (persona.collectedComments && !(await hasPersonaToken(persona))) return await importCollected(persona.collectedComments);
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
      next.sync.source = "api";
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
  // 도는 동기화는 원장마다 하나 (페르소나마다 원장이 다르다).
  const g = globalThis as typeof globalThis & { __threadsRepliesSyncs?: Map<string, Promise<ThreadsRepliesLedger>> };
  g.__threadsRepliesSyncs ??= new Map();
  const key = ledgerPath();
  const running = g.__threadsRepliesSyncs.get(key);
  if (running) return running;
  const run = runSync(opts.posts ?? DEFAULT_POSTS).finally(() => {
    g.__threadsRepliesSyncs?.delete(key);
  });
  g.__threadsRepliesSyncs.set(key, run);
  return run;
}

/** 10분 넘게 지났으면 동기화, 아니면 저장된 원장 그대로. */
export async function syncIfStale(): Promise<ThreadsRepliesLedger> {
  const ledger = await readRepliesLedger();
  return isStale(ledger) ? syncReplies() : ledger;
}
