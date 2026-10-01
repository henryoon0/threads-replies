// 보내기 대기열 — 파일·타이머·재시작 이어 보내기 (규칙은 send-queue-core.ts).
//
// 파일: 계정 기록 폴더의 send-queue.json (원장 옆). 계정마다 하나.
// fire-and-forget 3종 세트 (AGENTS.md):
//   ① 고아 자동 재개: registerSendQueueSweep 이 서버 시작·1분마다 때가 지난 대기를 보낸다(타이머가 사라져도).
//      시작 후 첫 스윕은 "보내던 중"을 끊긴 것으로 보고 다시 보내지 않는다(두 번 달림 방지).
//   ② 부분 저장: 한 건마다 sending → sent/failed 를 바로 파일에 남긴다.
//   ③ 하드 타임아웃: 실제 전송(sendThreadsReply)의 스레드 API 호출이 자기 시간 제한을 갖는다.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { registerSweepAdapter } from "@/lib/jobs/sweep";
import { currentPersona, runWithPersonaConfig } from "@/lib/personas/context";
import type { PersonaConfig } from "@/lib/personas/model";
import { listPersonaIds, readPersona } from "@/lib/personas/registry";
import { cancelItem, enqueueItem, processDue, type QueueItem, type QueuePayload, type SendOutcome, type SendQueue } from "./send-queue-core";
import { parseReplyImage, readEvidenceImage, sendThreadsReply } from "./send";
import { keyedLock, readRepliesLedger, threadsRepliesDir } from "./storage";

export type { QueueItem } from "./send-queue-core";

function queuePath(): string {
  return path.join(threadsRepliesDir(), "send-queue.json");
}

async function readQueue(): Promise<SendQueue> {
  try {
    const parsed = JSON.parse(await readFile(queuePath(), "utf8")) as Partial<SendQueue>;
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch {
    return { items: [] };
  }
}

async function writeQueue(q: SendQueue): Promise<void> {
  const file = queuePath();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(q, null, 2));
  await rename(tmp, file);
}

/** 대기열 파일은 한 번에 하나만 고친다 (계정마다) */
function withQueue<T>(fn: () => Promise<T>): Promise<T> {
  const lock = keyedLock("send-queue", queuePath());
  const run = lock.tail.then(fn);
  lock.tail = run.catch(() => undefined);
  return run;
}

/** 한 건을 실제로 보낸다 (이미지·근거 캡처를 그때 읽는다). */
async function sendOne(item: QueueItem): Promise<SendOutcome> {
  const image = item.image ? parseReplyImage(item.image) : item.evidenceImage ? await readEvidenceImage(item.replyId, item.evidenceImage) : undefined;
  if (typeof image === "string") return { ok: false, kind: "empty", message: image };
  const result = await sendThreadsReply(item.replyId, item.message, image);
  if (result.ok) return { ok: true };
  return { ok: false, kind: result.kind, message: result.message, ...(result.reauthUrl ? { reauthUrl: result.reauthUrl } : {}) };
}

/** 지금 계정 대기열에서 때가 된 것을 보낸다. */
async function runDue(restarted = false): Promise<void> {
  await withQueue(async () => {
    const q = await readQueue();
    if (!q.items.some((i) => i.status === "waiting" || i.status === "sending")) return;
    const ledger = await readRepliesLedger();
    const sent = (id: string) => Boolean(ledger.replies.find((r) => r.id === id)?.myReply);
    await processDue(q, Date.now(), sendOne, sent, { restarted, save: writeQueue });
  });
}

function timers(): Map<string, ReturnType<typeof setTimeout>> {
  const g = globalThis as typeof globalThis & { __threadsSendTimers?: Map<string, ReturnType<typeof setTimeout>> };
  g.__threadsSendTimers ??= new Map();
  return g.__threadsSendTimers;
}

/** 때가 되면 깨운다. 타이머가 사라져도(재시작) 1분 스윕이 보낸다. */
function wake(persona: PersonaConfig, replyId: string, delayMs: number) {
  const key = `${persona.id}#${replyId}`;
  clearTimeout(timers().get(key));
  const t = setTimeout(() => {
    timers().delete(key);
    void runWithPersonaConfig(persona, () => runDue()).catch((e) => console.warn("[send-queue] 보내기 실패:", e instanceof Error ? e.message : e));
  }, delayMs + 50);
  timers().set(key, t);
}

/** [보내기]: 대기열에 넣고 delayMs 뒤 서버가 보낸다. */
export async function enqueueSend(replyId: string, payload: QueuePayload, delayMs: number): Promise<QueueItem> {
  const persona = currentPersona();
  const item = await withQueue(async () => {
    const next = enqueueItem(await readQueue(), replyId, payload, Date.now(), delayMs);
    await writeQueue(next);
    return next.items.find((i) => i.replyId === replyId) as QueueItem;
  });
  wake(persona, replyId, delayMs);
  return item;
}

/** [되돌리기]: 보내기 시작 전이면 뺀다. */
export async function cancelSend(replyId: string): Promise<boolean> {
  return withQueue(async () => {
    const { queue, cancelled } = cancelItem(await readQueue(), replyId);
    if (cancelled) await writeQueue(queue);
    return cancelled;
  });
}

/** 이 댓글의 대기·결과 (없으면 null) */
export async function sendStatus(replyId: string): Promise<QueueItem | null> {
  return (await readQueue()).items.find((i) => i.replyId === replyId) ?? null;
}

/** 지금 계정 대기열 전체 (화면 알림용, 이미지 본문은 뺀다) */
export async function listSendQueue(): Promise<Omit<QueueItem, "image">[]> {
  return (await readQueue()).items.map(({ image: _image, ...rest }) => (void _image, rest));
}

/** 서버 시작·1분마다: 계정마다 때가 지난 대기를 보낸다. 시작 후 첫 번은 "보내던 중"을 끊긴 것으로 본다. */
export function registerSendQueueSweep(): void {
  registerSweepAdapter({
    name: "threads-send-queue",
    sweep: async () => {
      const g = globalThis as typeof globalThis & { __threadsSendSwept?: boolean };
      const restarted = !g.__threadsSendSwept;
      g.__threadsSendSwept = true;
      for (const id of await listPersonaIds()) {
        const persona = await readPersona(id);
        await runWithPersonaConfig(persona, () => runDue(restarted)).catch((e) => console.warn(`[send-queue] ${id}:`, e instanceof Error ? e.message : e));
      }
    },
  });
}
