// 스레드 댓글 — 읽기 전용 보기: 레일·질문 띠 숫자, 글별 묶음 + 대화 줄기.
// 원장만 다룬다 (동기화·AI·외부 호출 없음).
import { isPending, type ThreadsPostRef, type ThreadsRepliesLedger, type ThreadsReply } from "./model";
import { readRepliesLedger } from "./storage";

const MAX_CHAIN_DEPTH = 8;

export interface ThreadsSummary {
  /** 아직 답할 차례인 댓글 */
  pending: number;
  /** 그중 질문 */
  questions: number;
  /** 그중 답할 수 있음 판정이 난 질문 (질문 띠) */
  questionsReady: number;
  /** 답했거나 건너뛴 댓글 */
  history: number;
}

export function summarize(ledger: ThreadsRepliesLedger): ThreadsSummary {
  const pending = ledger.replies.filter(isPending);
  const questions = pending.filter((r) => r.intent === "question");
  return {
    pending: pending.length,
    questions: questions.length,
    questionsReady: questions.filter((r) => r.answer?.verdict === "answerable").length,
    history: ledger.replies.filter((r) => !isPending(r)).length,
  };
}

export async function readThreadsSummary(): Promise<ThreadsSummary> {
  return summarize(await readRepliesLedger());
}

/** 댓글의 바로 위 남의 댓글 (직접 단 것이든, 그 댓글에 내가 단 답에 단 것이든). */
function parentOf(ledger: ThreadsRepliesLedger, reply: ThreadsReply): ThreadsReply | undefined {
  if (reply.repliedToId === reply.postId) return undefined;
  return ledger.replies.find(
    (r) => r.postId === reply.postId && (r.id === reply.repliedToId || r.myReply?.id === reply.repliedToId)
  );
}

function ancestors(ledger: ThreadsRepliesLedger, reply: ThreadsReply): ThreadsReply[] {
  const out: ThreadsReply[] = [];
  let cur = parentOf(ledger, reply);
  while (cur && out.length < MAX_CHAIN_DEPTH && !out.includes(cur)) {
    out.unshift(cur);
    cur = parentOf(ledger, cur);
  }
  return out;
}

/**
 * 이 댓글에 이르기까지의 대화 (오래된 것부터). 원글에 바로 단 댓글이면 undefined.
 * 초안기에 그대로 넘기는 모양이다.
 */
export function conversationFor(
  ledger: ThreadsRepliesLedger,
  reply: ThreadsReply,
  /** 내 아이디 (연결된 계정) — 대화 줄기에서 내 답을 표시한다 */
  me: string
): { username: string; text: string }[] | undefined {
  if (reply.repliedToId === reply.postId) return undefined;
  const turns: { username: string; text: string }[] = [];
  for (const a of ancestors(ledger, reply)) {
    turns.push({ username: a.username, text: a.text });
    if (a.myReply) turns.push({ username: me, text: a.myReply.text });
  }
  const last = turns[turns.length - 1];
  if (reply.repliedToText && !(last?.username === me && last.text === reply.repliedToText)) {
    turns.push({ username: me, text: reply.repliedToText });
  }
  return turns.length ? turns : undefined;
}

export interface ReplyThread {
  /** 줄기의 첫 남의 댓글 */
  root: ThreadsReply;
  /** 같은 줄기에서 이어진 남의 댓글 (오래된 것부터). 각자 repliedToText·myReply 로 내 답을 보여준다. */
  followUps: ThreadsReply[];
  /** 이 줄기에 아직 답할 차례인 댓글 수 */
  pending: number;
}

export interface PostGroup {
  post: ThreadsPostRef;
  threads: ReplyThread[];
  pending: number;
  questions: number;
}

/** 글별 묶음 + 대화 줄기. 댓글 있는 글만, 답할 차례가 있는 글이 먼저, 그 안에서는 최신순. */
export function groupByPost(ledger: ThreadsRepliesLedger): PostGroup[] {
  const threadsByRoot = new Map<string, ReplyThread>();
  const chronological = [...ledger.replies].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  for (const reply of chronological) {
    const root = ancestors(ledger, reply)[0] ?? reply;
    const thread = threadsByRoot.get(root.id) ?? { root, followUps: [], pending: 0 };
    if (root.id !== reply.id) thread.followUps.push(reply);
    if (isPending(reply)) thread.pending++;
    threadsByRoot.set(root.id, thread);
  }
  const groups = new Map<string, PostGroup>();
  for (const post of ledger.posts) groups.set(post.id, { post, threads: [], pending: 0, questions: 0 });
  for (const thread of threadsByRoot.values()) {
    const group = groups.get(thread.root.postId);
    if (!group) continue;
    group.threads.push(thread);
    group.pending += thread.pending;
    group.questions += [thread.root, ...thread.followUps].filter(
      (r) => isPending(r) && r.intent === "question"
    ).length;
  }
  const latest = (t: ReplyThread) => Date.parse((t.followUps.at(-1) ?? t.root).timestamp);
  return [...groups.values()]
    .filter((g) => g.threads.length > 0)
    .map((g) => ({ ...g, threads: g.threads.sort((a, b) => b.pending - a.pending || latest(b) - latest(a)) }))
    .sort((a, b) => Number(b.pending > 0) - Number(a.pending > 0) || Date.parse(b.post.timestamp) - Date.parse(a.post.timestamp));
}
