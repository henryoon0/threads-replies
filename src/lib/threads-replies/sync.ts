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

// 10-02 henry "대기 목록이 스레드와 일치해야": 스레드 앱에서 직접 단 답도 5분 안에 반영되게 (예전 10분)
export const SYNC_STALE_MS = 5 * 60 * 1000;
const DEFAULT_POSTS = 20;
const FETCH_CONCURRENCY = 4;

export interface FetchedConversation {
  post: ThreadsPostRef;
  replies: RawConversationReply[];
}

function byTimeDesc(a: { timestamp: string }, b: { timestamp: string }): number {
  return Date.parse(b.timestamp) - Date.parse(a.timestamp);
}

/** 글 주소의 끝 코드 (…/post/DdvdAKek5at → DdvdAKek5at). 브라우저 수집본은 이 코드를 글 id 로 썼다 */
export function shortcodeOf(permalink: string | undefined): string | undefined {
  return permalink?.match(/\/post\/([^/?#]+)/)?.[1];
}

/** 같은 사람·같은 글 — 수집본 댓글(id 가 다르다)을 API 댓글에 잇는 열쇠 */
const sameComment = (r: { username?: string; text?: string }) => `${r.username ?? ""}\n${(r.text ?? "").trim()}`;

function repliesOfPost(
  post: ThreadsPostRef,
  raw: RawConversationReply[],
  prev: Map<string, ThreadsReply>,
  collected: Map<string, ThreadsReply> = new Map()
): ThreadsReply[] {
  const mine = raw.filter((r) => r.is_reply_owned_by_me);
  const myById = new Map(mine.map((r) => [r.id, r]));
  // 댓글 하나에 내가 여러 번 답했으면 가장 먼저 단 답을 myReply 로 둔다.
  const myByParent = new Map<string, RawConversationReply>();
  for (const r of [...mine].sort((a, b) => Date.parse(a.timestamp ?? "") - Date.parse(b.timestamp ?? ""))) {
    const parent = r.replied_to?.id;
    if (parent && !myByParent.has(parent)) myByParent.set(parent, r);
  }
  const settledOf = settlement(raw, post.id);
  return raw
    .filter((r) => !r.is_reply_owned_by_me)
    .map((r) => {
      const repliedToId = r.replied_to?.id ?? post.id;
      const parentMine = myById.get(repliedToId);
      // 내 이어쓰기 칸(원글에 바로 단 내 답)에 단 말은 원글 댓글과 같다. 남의 댓글에 단 내 답에 온 말만 대화 줄기.
      const isReplyToMyReply = !!parentMine && parentMine.replied_to?.id !== post.id;
      const next = baseReply(r, post.id, repliedToId, isReplyToMyReply);
      attachKnown(next, parentMine, myByParent.get(r.id), prev.get(r.id) ?? collected.get(sameComment(r)));
      const settled = next.myReply ? undefined : settledOf(r.id);
      if (settled) next.settled = settled;
      return next;
    });
}

/**
 * 대화 트리로 "답할 차례"를 정한다 (10-02 henry: "나의 답변을 기다리는 댓글, 상대방이 댓글을 남기고 끝난 것들만").
 * 남의 댓글 하나 아래(자식·손자 …)를 본다:
 *  - 어딘가에 내 답이 있으면 answered — 바로 아래가 아니어도 그 대화에서 이미 답했다
 *  - 내 답은 없고 다른 말(같은 사람의 이어쓰기·다른 사람)이 이어졌으면 continued — 차례는 대화 끝 댓글로
 *  - 아래에 아무것도 없으면 undefined — 상대가 남기고 끝난 자리 = 답할 차례
 */
export function settlement(raw: RawConversationReply[], postId: string): (id: string) => "answered" | "continued" | undefined {
  const kids = new Map<string, RawConversationReply[]>();
  for (const r of raw) {
    const parent = r.replied_to?.id ?? postId;
    kids.set(parent, [...(kids.get(parent) ?? []), r]);
  }
  const memo = new Map<string, boolean>();
  const mineBelow = (id: string, seen = new Set<string>()): boolean => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    if (seen.has(id)) return false; // 고리 방어
    seen.add(id);
    const found = (kids.get(id) ?? []).some((k) => k.is_reply_owned_by_me || mineBelow(k.id, seen));
    memo.set(id, found);
    return found;
  };
  return (id) => (mineBelow(id) ? "answered" : (kids.get(id)?.length ?? 0) > 0 ? "continued" : undefined);
}

function baseReply(r: RawConversationReply, postId: string, repliedToId: string, isReplyToMyReply: boolean): ThreadsReply {
  const text = r.text ?? "";
  return {
    id: r.id,
    postId,
    username: r.username ?? "(알 수 없음)",
    text,
    timestamp: r.timestamp ?? "",
    ...(r.permalink ? { permalink: r.permalink } : {}),
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
  // 브라우저 수집본으로 들어온 같은 글(id = 주소 코드)은 API 로 받은 글로 바꾼다 — 안 그러면 답한 댓글이 수집본 쪽에 "안 답함"으로 영영 남는다 (10-02).
  // 수집본 댓글의 건너뛰기·초안은 같은 사람·같은 글인 API 댓글이 이어받는다.
  const superseded = new Set(fetched.map((f) => shortcodeOf(f.post.permalink)).filter((c): c is string => !!c && !fetchedIds.has(c)));
  const collected = new Map(ledger.replies.filter((r) => superseded.has(r.postId)).map((r) => [sameComment(r), r]));
  const posts = new Map(ledger.posts.filter((p) => !superseded.has(p.id)).map((p) => [p.id, p]));
  for (const f of fetched) posts.set(f.post.id, f.post);
  const replies = [
    ...ledger.replies.filter((r) => !fetchedIds.has(r.postId) && !superseded.has(r.postId)),
    ...fetched.flatMap((f) => repliesOfPost(f.post, f.replies, prev, collected)),
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

/** 5분 넘게 지났으면 동기화, 아니면 저장된 원장 그대로. */
export async function syncIfStale(): Promise<ThreadsRepliesLedger> {
  const ledger = await readRepliesLedger();
  return isStale(ledger) ? syncReplies() : ledger;
}

/** 지금 도는 동기화가 있나 (이 원장 기준) */
export function isSyncing(): boolean {
  const g = globalThis as typeof globalThis & { __threadsRepliesSyncs?: Map<string, Promise<ThreadsRepliesLedger>> };
  return g.__threadsRepliesSyncs?.has(ledgerPath()) ?? false;
}

/**
 * 화면용: 저장된 원장을 바로 돌려주고, 오래됐으면 동기화는 뒤에서 돌린다 (10-02 실측: 동기화 28초 동안 첫 화면이 비어 있었다).
 * 한 번도 동기화한 적 없으면 보여 줄 게 없으니 기다린다.
 */
export async function ledgerSyncingInBackground(): Promise<{ ledger: ThreadsRepliesLedger; syncing: boolean }> {
  const ledger = await readRepliesLedger();
  if (!isStale(ledger)) return { ledger, syncing: isSyncing() };
  if (!ledger.sync.lastSyncAt) return { ledger: await syncReplies(), syncing: false };
  void syncReplies().catch(() => {});
  return { ledger, syncing: true };
}
