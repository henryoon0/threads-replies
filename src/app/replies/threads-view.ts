// 스레드 댓글 목록의 보기 규칙 (순수 함수). 서버가 준 글별 묶음(PostGroup)을
// 레일 칸(댓글 · 질문 · 기록)에 맞게 거르고, 줄기를 들여쓴 노드로 펴고, 선택 순서를 만든다.
import { isPending, type ThreadsReply } from "@/lib/threads-replies/model";
import { usableDraft } from "@/lib/threads-replies/usable-draft";
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
  // 기록 = 내가 답했거나(아래 대화에서 답한 것 포함) 건너뛴 것. 대화가 이어져 차례가 넘어간 댓글(continued)은 기록이 아니다
  if (view === "history") return !!r.myReply || !!r.skipped || r.settled === "answered";
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

/** 글 머리의 첫 줄 */
export function firstLine(text: string): string {
  return text.split("\n").find((l) => l.trim())?.trim() ?? "(본문 없는 글)";
}

/** 글에 달린 댓글 수 (묶음 안 전체) */
function replyCount(g: PostGroup): number {
  return g.threads.reduce((n, t) => n + 1 + t.followUps.length, 0);
}

/* ── 지금 답할 5개 (시안 픽 7) ─────────────────────────── */

export const TOP_N = 5;

export type UrgentReason = "질문" | "관문" | "오래 기다림";

export interface UrgentItem {
  reply: ThreadsReply;
  reasons: UrgentReason[];
}

const DAY_MS = 86_400_000;

function waitedMs(r: ThreadsReply, now: number): number {
  const t = Date.parse(r.timestamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(t) ? now - t : 0;
}

/**
 * 답할 차례 댓글 가운데 지금 답할 n개: 질문 → 관문에 걸린 초안 → 오래 기다린 순.
 * gated(reply) = 그 댓글 초안이 관문에 걸렸나 (화면이 규칙으로 검사해 넘긴다).
 */
export function urgentReplies(
  groups: PostGroup[],
  view: ThreadsView,
  gated: (r: ThreadsReply) => boolean,
  n = TOP_N,
  now = Date.now()
): UrgentItem[] {
  const pool = focusOrder(groups, view === "history" ? "comments" : view);
  const byId = new Map<string, ThreadsReply>();
  for (const g of groups) for (const t of g.threads) for (const r of repliesOf(t)) byId.set(r.id, r);
  const scored = pool
    .map((id) => byId.get(id))
    .filter((r): r is ThreadsReply => Boolean(r))
    .map((reply) => {
      const q = reply.intent === "question";
      const gate = gated(reply);
      const reasons: UrgentReason[] = [];
      if (q) reasons.push("질문");
      if (gate) reasons.push("관문");
      if (waitedMs(reply, now) >= DAY_MS) reasons.push("오래 기다림");
      return { reply, reasons, rank: (q ? 0 : 2) + (gate ? 0 : 1), waited: waitedMs(reply, now) };
    });
  scored.sort((a, b) => a.rank - b.rank || b.waited - a.waited);
  return scored.slice(0, n).map(({ reply, reasons }) => ({ reply, reasons }));
}

export type QueueSort = "old" | "new";
export interface QueueFilter {
  sort: QueueSort;
  questionsOnly: boolean;
}

/**
 * 한 버튼 메뉴(10-02 픽)의 목록: 답 안 한 댓글을 글 묶음 없이 한 줄로.
 * 오래된 순 = 가장 오래 기다린 것부터, 최근 순 = 방금 달린 것부터. 질문만 = 아직 안 답한 질문.
 */
export function filteredQueue(groups: PostGroup[], filter: QueueFilter): ThreadsReply[] {
  const view: ThreadsView = filter.questionsOnly ? "questions" : "comments";
  const out: ThreadsReply[] = [];
  for (const g of groups) for (const t of g.threads) for (const r of repliesOf(t)) if (isFocusable(r, view)) out.push(r);
  const dir = filter.sort === "old" ? 1 : -1;
  return out.sort((a, b) => dir * (Date.parse(a.timestamp) - Date.parse(b.timestamp)));
}

/**
 * 완성된 것부터 배달 (10-02 henry "유저가 빠르게 대응하는 게 목표"): 답이 있는 댓글은 위 칸, 아직 없거나 다시 쓰는 중(busy)은 아래 칸.
 * (10-02 henry 재확인: 쓰는 중은 아래 칸이 맞다 — 제자리에 두는 안은 되돌렸다)
 * 두 칸 다 목록 순서(오래된 순 등) 그대로 — 완성 시각 순으로 세우면 예전에 써 둔 답 수백 개 뒤로 새 답이 밀린다.
 * [보내기] 뒤 "다음 댓글"은 이 순서를 따르므로 준비된 답부터 열린다.
 */
export function splitByReady(items: readonly ThreadsReply[], busy: ReadonlySet<string>): { ready: ThreadsReply[]; preparing: ThreadsReply[] } {
  // 줄의 초록 점과 같은 기준(usableDraft) — 점 있는 줄이 한 덩어리로 이어진다 (10-02 henry "중간에 띄어지면 안 돼")
  const isReady = (r: ThreadsReply) => Boolean(usableDraft(r.answer)) && !busy.has(r.id);
  const ready = items.filter(isReady);
  return { ready, preparing: items.filter((r) => !isReady(r)) };
}
