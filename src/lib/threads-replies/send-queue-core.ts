// 보내기 대기열 규칙 (2026-10-02 henry: "한번 발송된 건 발송이 되어야 한다. 대기가 있다면 백그라운드에서 보내라").
//
// [보내기]를 누르면 화면이 아니라 서버 대기열에 넣는다. 5초 되돌리기 창이 지나면 서버가 보낸다 —
// 다른 댓글로 옮기거나 창을 닫아도 보낸다. 되돌리기는 보내기 시작 전(waiting)에만 된다.
// 보내던 중(sending) 앱이 꺼지면 다시 보내지 않는다(두 번 달릴 수 있다): 이미 달렸으면 sent, 아니면 확인 필요(failed·unknown).
// 순수 — I/O 없음. 파일·타이머는 send-queue.ts.

export type QueueStatus = "waiting" | "sending" | "sent" | "failed";

export interface QueuePayload {
  message: string;
  /** 붙인 이미지 data URL */
  image?: string;
  /** 근거 캡처 경로 */
  evidenceImage?: string;
}

export interface QueueItem extends QueuePayload {
  replyId: string;
  status: QueueStatus;
  /** 이 시각이 지나면 보낸다 (ISO) */
  dueAt: string;
  updatedAt: string;
  error?: string;
  kind?: string;
  reauthUrl?: string;
}

export interface SendQueue {
  items: QueueItem[];
}

export type SendOutcome = { ok: true } | { ok: false; kind: string; message: string; reauthUrl?: string };

/** 끝난 기록은 이만큼만 남긴다 (화면 알림·다시 열 때 실패 표시용) */
const KEEP_DONE_MS = 24 * 60 * 60 * 1000;

const iso = (ms: number) => new Date(ms).toISOString();

/** 대기열에 넣는다. 같은 댓글이 기다리는 중이면 새 글로 바꾼다. 끝난 지 오래된 기록은 정리한다. */
export function enqueueItem(queue: SendQueue, replyId: string, payload: QueuePayload, now: number, delayMs: number): SendQueue {
  const kept = queue.items.filter((i) => i.replyId !== replyId && !(isDone(i) && now - Date.parse(i.updatedAt) > KEEP_DONE_MS));
  return { items: [...kept, { replyId, ...payload, status: "waiting", dueAt: iso(now + delayMs), updatedAt: iso(now) }] };
}

export function isDone(item: QueueItem): boolean {
  return item.status === "sent" || item.status === "failed";
}

/** 되돌리기: 기다리는 중일 때만 뺀다. */
export function cancelItem(queue: SendQueue, replyId: string): { queue: SendQueue; cancelled: boolean } {
  const item = queue.items.find((i) => i.replyId === replyId);
  if (!item || item.status !== "waiting") return { queue, cancelled: false };
  return { queue: { items: queue.items.filter((i) => i !== item) }, cancelled: true };
}

function patch(queue: SendQueue, replyId: string, next: Partial<QueueItem>, now: number): SendQueue {
  return { items: queue.items.map((i) => (i.replyId === replyId ? { ...i, ...next, updatedAt: iso(now) } : i)) };
}

/** 앱이 꺼졌다 켜졌을 때: 보내던 중이던 것은 다시 보내지 않고 결과를 정한다. */
function settleInterrupted(queue: SendQueue, alreadySent: (replyId: string) => boolean, now: number): SendQueue {
  let q = queue;
  for (const i of queue.items.filter((x) => x.status === "sending")) {
    q = alreadySent(i.replyId)
      ? patch(q, i.replyId, { status: "sent" }, now)
      : patch(q, i.replyId, { status: "failed", kind: "unknown", error: "보내는 중에 앱이 꺼졌어요. 스레드에 달렸는지 확인하고, 안 달렸으면 다시 보내 주세요." }, now);
  }
  return q;
}

/**
 * 때가 된 것을 보낸다. send 는 한 건을 실제로 보내는 함수, alreadySent 는 원장에 이미 내 답이 있나.
 * restarted = 앱이 막 켜짐(보내던 중이던 건 끊긴 것). save 는 상태가 바뀔 때마다 부른다(보내기 직전 sending 을 먼저 남기려고).
 */
export async function processDue(
  queue: SendQueue,
  now: number,
  send: (item: QueueItem) => Promise<SendOutcome>,
  alreadySent: (replyId: string) => boolean,
  opts: { restarted?: boolean; save?: (q: SendQueue) => Promise<void> } = {}
): Promise<SendQueue> {
  let q = opts.restarted ? settleInterrupted(queue, alreadySent, now) : queue;
  const due = q.items.filter((i) => i.status === "waiting" && Date.parse(i.dueAt) <= now);
  for (const item of due) {
    q = patch(q, item.replyId, { status: "sending" }, now);
    await opts.save?.(q);
    const out = await send(item);
    q = out.ok
      ? patch(q, item.replyId, { status: "sent", error: undefined, kind: undefined }, Date.now())
      : patch(q, item.replyId, { status: "failed", error: out.message, kind: out.kind, ...(out.reauthUrl ? { reauthUrl: out.reauthUrl } : {}) }, Date.now());
    await opts.save?.(q);
  }
  return q;
}
