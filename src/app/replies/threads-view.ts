// 스레드 댓글 목록의 보기 규칙 (순수 함수). 서버가 준 글별 묶음(PostGroup)을
// 레일 칸(댓글 · 질문 · 기록)에 맞게 거르고, 줄기를 들여쓴 노드로 펴고, 선택 순서를 만든다.
import { isPending, type ThreadsReply } from "@/lib/threads-replies/model";
import type { PostGroup, ReplyThread, ThreadsSummary } from "@/lib/threads-replies/summary";

export type ThreadsView = "comments" | "questions" | "history";

export interface ThreadsData {
  groups: PostGroup[];
  summary: ThreadsSummary;
  sync: { lastSyncAt?: string; lastError?: string; postsScanned?: number };
}

/** 줄기 한 칸. them = 남의 댓글, me = 내 답글 */
export type ChainNode =
  | { kind: "them"; reply: ThreadsReply }
  | { kind: "me"; key: string; text: string };

/** 댓글 → 내 답 → 상대 재답 … 순서로 편다. 같은 내 답이 두 번 이어지면 한 번만 그린다. */
export function chainOf(thread: ReplyThread): ChainNode[] {
  const nodes: ChainNode[] = [];
  const pushMe = (key: string, text: string) => {
    const last = nodes.at(-1);
    if (last?.kind === "me" && last.text === text) return;
    nodes.push({ kind: "me", key, text });
  };
  for (const reply of [thread.root, ...thread.followUps]) {
    if (reply.repliedToText) pushMe(`to-${reply.id}`, reply.repliedToText);
    nodes.push({ kind: "them", reply });
    if (reply.myReply) pushMe(reply.myReply.id, reply.myReply.text);
  }
  return nodes;
}

const isOpenQuestion = (r: ThreadsReply) => isPending(r) && r.intent === "question";

function repliesOf(thread: ReplyThread): ThreadsReply[] {
  return [thread.root, ...thread.followUps];
}

/** 이 보기에서 누를 수 있는(오른쪽 패널로 열 수 있는) 댓글인가 */
export function isFocusable(r: ThreadsReply, view: ThreadsView): boolean {
  if (view === "history") return !isPending(r);
  if (view === "questions") return isOpenQuestion(r);
  return isPending(r);
}

/** 보이는 글 묶음. total = 거르기 전 그 글의 댓글 수 (글 머리 숫자) */
export type VisibleGroup = PostGroup & { total: number };

/** 레일 칸에 맞춰 줄기와 글을 거른다. 줄기·글 순서는 서버 순서(답할 차례 먼저, 최신순)를 그대로 쓴다. */
export function visibleGroups(groups: PostGroup[], view: ThreadsView): VisibleGroup[] {
  const out: VisibleGroup[] = [];
  for (const g of groups) {
    const threads = g.threads.filter((t) => repliesOf(t).some((r) => isFocusable(r, view)));
    if (threads.length) out.push({ ...g, threads, total: replyCount(g) });
  }
  return out;
}

/** 내 차례인 대화 줄기 (답할 댓글이 있고, 댓글 한 줄이 아닌 줄기)는 펴서 그린다. */
export function isExpandedThread(thread: ReplyThread, view: ThreadsView): boolean {
  if (view === "history") return true;
  return thread.pending > 0 && chainOf(thread).length > 1;
}

/** 목록에 보이는 순서대로 누를 수 있는 댓글 id. 다음 댓글로 넘기기에 쓴다. */
export function focusOrder(groups: PostGroup[], view: ThreadsView): string[] {
  const ids: string[] = [];
  for (const g of groups) {
    for (const t of g.threads) {
      for (const r of repliesOf(t)) if (isFocusable(r, view)) ids.push(r.id);
    }
  }
  return ids;
}

/** current 다음 id. 목록에서 빠졌으면(답해서 사라짐) 그 자리 다음 것을, 끝이면 앞 것을. */
export function nextId(order: string[], current: string | null, previousOrder: string[] = order): string | null {
  if (!order.length) return null;
  if (!current) return order[0];
  const at = order.indexOf(current);
  if (at >= 0) return order[at + 1] ?? order[at - 1] ?? null;
  // 사라진 id: 옛 순서에서 그 뒤에 있던 것 중 아직 남은 첫 번째
  const old = previousOrder.indexOf(current);
  if (old >= 0) {
    const after = previousOrder.slice(old + 1).find((id) => order.includes(id));
    if (after) return after;
  }
  return order.at(-1) ?? null;
}

export interface BandQuestion {
  reply: ThreadsReply;
  ready: boolean;
}

/** 질문 띠: 답이 필요한 질문 전부 (글 순서 그대로) + 근거 준비된 수 */
export function openQuestions(groups: PostGroup[]): { items: BandQuestion[]; ready: number } {
  const items: BandQuestion[] = [];
  for (const g of groups) {
    for (const t of g.threads) {
      for (const r of repliesOf(t)) {
        if (isOpenQuestion(r)) items.push({ reply: r, ready: r.answer?.verdict === "answerable" });
      }
    }
  }
  return { items, ready: items.filter((q) => q.ready).length };
}

/** 글 머리의 첫 줄 */
export function firstLine(text: string): string {
  return text.split("\n").find((l) => l.trim())?.trim() ?? "(본문 없는 글)";
}

/** 글에 달린 댓글 수 (묶음 안 전체) */
function replyCount(g: PostGroup): number {
  return g.threads.reduce((n, t) => n + 1 + t.followUps.length, 0);
}
