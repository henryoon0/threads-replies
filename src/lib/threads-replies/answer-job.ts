// 스레드 댓글 답 초안 잡 — fire-and-forget 3종 세트 (AGENTS.md):
//   ① 고아 자동 재개: sweep 어댑터(registerThreadsRepliesSweep) + GET 의 ensureAnswers 가 runAnswerJob 을 다시 부른다(멱등).
//   ② 부분 저장: 댓글 1건마다 원장 answer 저장 + 잡 done 갱신. 처리 중에는 heartbeat 로 updatedAt 을 민다.
//   ③ 하드 타임아웃: 댓글 1건(검색+초안) 전체에 THREADS_ANSWER_TIMEOUT_MS 상한.
// 한 번에 잡 하나만 (CLI 슬롯 보호). 질문만 근거를 찾고, 나머지는 근거 없이 짧은 답만 만든다.
import { randomUUID } from "crypto";
import { registerSweepAdapter, type ActiveJobRef, type ListResumeSweepAdapter } from "@/lib/jobs/sweep";
import { withConsistency } from "./consistency";
import { generateAnswer } from "./draft";
import { isPending, type AnswerSource, type ReplyAnswer, type ThreadsPostRef, type ThreadsRepliesLedger, type ThreadsReply } from "./model";
import { pastSaidFor } from "./past-said";
import { retrieveForReply } from "./retrieve";
import { envMs, readAnswerJob, readRepliesLedger, updateRepliesLedger, writeAnswerJob, type AnswerJob } from "./storage";
import { readProfile } from "@/lib/profile";
import { conversationFor } from "./summary";

const DEFAULT_ANSWER_TIMEOUT_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 30_000;

export type AnswerScope = "all" | "questions" | { postId: string } | { replyIds: string[] };

export interface RegenerateOptions {
  extraLinks?: string[];
  instruction?: string;
  myNote?: string;
  allowWeb?: boolean;
}

export type RetrieveTrace = { stage: string; ms: number; count: number; note?: string }[];

function scopeLabel(scope: AnswerScope): string {
  if (typeof scope === "string") return scope;
  return "postId" in scope ? `post:${scope.postId}` : "replies";
}

/** 답 초안이 필요한 댓글. 질문 먼저, 그 안에서 최신순. */
export function answerTargets(ledger: ThreadsRepliesLedger, scope: AnswerScope): ThreadsReply[] {
  const inScope = (r: ThreadsReply) => {
    if (scope === "all") return true;
    if (scope === "questions") return r.intent === "question";
    if ("postId" in scope) return r.postId === scope.postId;
    return scope.replyIds.includes(r.id);
  };
  return ledger.replies
    .filter((r) => isPending(r) && !r.answer && inScope(r))
    .sort(
      (a, b) =>
        Number(b.intent === "question") - Number(a.intent === "question") ||
        Date.parse(b.timestamp) - Date.parse(a.timestamp)
    );
}

// ── 잡 파일 쓰기는 한 줄로 (heartbeat 와 진행 갱신이 겹치지 않게) ──
function jobLock(): { tail: Promise<unknown> } {
  const g = globalThis as typeof globalThis & { __threadsAnswerJobLock?: { tail: Promise<unknown> } };
  g.__threadsAnswerJobLock ??= { tail: Promise.resolve() };
  return g.__threadsAnswerJobLock;
}

/** 같은 잡일 때만 고쳐 저장한다. 다른 잡이거나 없으면 null. */
async function patchJob(jobId: string, fn: (job: AnswerJob) => AnswerJob): Promise<AnswerJob | null> {
  const lock = jobLock();
  const run = lock.tail.then(async () => {
    const job = await readAnswerJob();
    if (!job || job.id !== jobId) return null;
    const next = { ...fn(job), updatedAt: new Date().toISOString() };
    await writeAnswerJob(next);
    return next;
  });
  lock.tail = run.catch(() => undefined);
  return run;
}

function runningSet(): Set<string> {
  const g = globalThis as typeof globalThis & { __threadsAnswerJobs?: Set<string> };
  g.__threadsAnswerJobs ??= new Set();
  return g.__threadsAnswerJobs;
}

function postOf(ledger: ThreadsRepliesLedger, reply: ThreadsReply): ThreadsPostRef {
  return ledger.posts.find((p) => p.id === reply.postId) ?? { id: reply.postId, text: "", timestamp: "" };
}

async function withDeadline<T>(work: Promise<T>, controller: AbortController, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`답 초안 시간 초과 (${Math.round(ms / 1000)}초)`));
    }, ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** 댓글 하나의 답 초안: 질문(또는 붙인 링크가 있으면) 근거 검색 → 초안. 원장에는 쓰지 않는다. */
async function draftOne(
  ledger: ThreadsRepliesLedger,
  reply: ThreadsReply,
  opts: RegenerateOptions = {}
): Promise<{ answer: ReplyAnswer; trace: RetrieveTrace }> {
  const post = postOf(ledger, reply);
  const controller = new AbortController();
  const work = (async () => {
    let sources: AnswerSource[] = [];
    let trace: RetrieveTrace = [];
    if (reply.intent === "question" || (opts.extraLinks?.length ?? 0) > 0) {
      const found = await retrieveForReply({
        reply,
        post,
        extraLinks: opts.extraLinks,
        allowWeb: opts.allowWeb,
        signal: controller.signal,
      });
      sources = found.sources;
      trace = found.trace;
    }
    const profile = await readProfile();
    const drafted = await generateAnswer({
      reply,
      post,
      sources,
      conversation: conversationFor(ledger, reply, profile.username),
      instruction: opts.instruction,
      myNote: opts.myNote,
      pastSaid: pastSaidFor(ledger, reply),
    });
    // 예전 답과 어긋나는 문장을 찾아 붙인다 (글은 고치지 않는다, 실패해도 초안은 그대로).
    const answer = await withConsistency(drafted, profile.username ? `@${profile.username}` : "주인");
    return { answer, trace };
  })();
  return withDeadline(work, controller, envMs("THREADS_ANSWER_TIMEOUT_MS", DEFAULT_ANSWER_TIMEOUT_MS));
}

async function saveAnswer(replyId: string, answer: ReplyAnswer): Promise<void> {
  await updateRepliesLedger((l) => ({
    ...l,
    replies: l.replies.map((r) => (r.id === replyId ? { ...r, answer } : r)),
  }));
}

/** 잡 실행 — 멱등, 절대 reject 하지 않는다. sweep·GET 이 언제든 다시 불러도 안전. */
export async function runAnswerJob(jobId: string): Promise<void> {
  const running = runningSet();
  if (running.has(jobId)) return;
  running.add(jobId);
  const heartbeat = setInterval(() => void patchJob(jobId, (j) => j).catch(() => {}), HEARTBEAT_MS);
  try {
    const job = await readAnswerJob();
    if (!job || job.id !== jobId || job.status !== "running") return;
    for (const replyId of job.replyIds) {
      const current = await readAnswerJob();
      if (!current || current.id !== jobId || current.status !== "running") return; // 중지됨
      if (current.done.includes(replyId) || current.failed.some((f) => f.replyId === replyId)) continue;
      const ledger = await readRepliesLedger();
      const reply = ledger.replies.find((r) => r.id === replyId);
      // 그 사이 답했거나 건너뛰었거나 초안이 생긴 댓글은 조용히 완료 처리
      if (!reply || !isPending(reply) || reply.answer) {
        await patchJob(jobId, (j) => ({ ...j, done: [...j.done, replyId] }));
        continue;
      }
      await patchJob(jobId, (j) => ({ ...j, current: replyId }));
      try {
        const { answer } = await draftOne(ledger, reply);
        await saveAnswer(replyId, answer);
        await patchJob(jobId, (j) => ({ ...j, current: undefined, done: [...j.done, replyId] }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await patchJob(jobId, (j) => ({
          ...j,
          current: undefined,
          failed: [...j.failed, { replyId, error: message.slice(0, 300) }],
        }));
      }
    }
    await patchJob(jobId, (j) => (j.status === "running" ? { ...j, status: "done" } : j));
  } catch {
    // settle — 잡 파일 접근 자체가 실패. 다음 sweep 이 재시도한다.
  } finally {
    clearInterval(heartbeat);
    running.delete(jobId);
  }
}

/**
 * 초안이 없는 답할 차례 댓글에 답 초안을 채우는 잡을 시작한다 (fire-and-forget 용).
 * 도는 잡이 있으면 새로 만들지 않고 그 잡을 (고아면 재개해서) 돌려준다. 할 게 없으면 null.
 * limit: 이번 잡에 넣을 최대 댓글 수 (시험용).
 */
export async function ensureAnswers(scope: AnswerScope = "all", opts: { limit?: number } = {}): Promise<AnswerJob | null> {
  const existing = await readAnswerJob();
  if (existing?.status === "running") {
    void runAnswerJob(existing.id);
    return existing;
  }
  const targets = answerTargets(await readRepliesLedger(), scope);
  const picked = opts.limit !== undefined ? targets.slice(0, Math.max(0, opts.limit)) : targets;
  if (picked.length === 0) return null;
  const now = new Date().toISOString();
  const job: AnswerJob = {
    id: randomUUID(),
    scope: scopeLabel(scope),
    replyIds: picked.map((r) => r.id),
    done: [],
    failed: [],
    status: "running",
    createdAt: now,
    updatedAt: now,
  };
  await writeAnswerJob(job);
  void runAnswerJob(job.id);
  return job;
}

/** 도는 잡을 멈춘다 (지금 처리 중인 1건은 끝까지 가고 저장된다). */
export async function stopAnswerJob(): Promise<AnswerJob | null> {
  const job = await readAnswerJob();
  if (!job || job.status !== "running") return job;
  return patchJob(job.id, (j) => ({ ...j, status: "stopped" }));
}

/** henry 가 누른 다시 쓰기: 붙인 링크·지시·henry 메모를 얹어 바로 다시 만든다(잡을 거치지 않음). 원장에 저장. */
export async function regenerateAnswer(
  replyId: string,
  opts: RegenerateOptions = {}
): Promise<{ answer: ReplyAnswer; trace: RetrieveTrace } | null> {
  const ledger = await readRepliesLedger();
  const reply = ledger.replies.find((r) => r.id === replyId);
  if (!reply) return null;
  const result = await draftOne(ledger, reply, opts);
  await saveAnswer(replyId, result.answer);
  return result;
}

// ── 고아 재개 (instrumentation.ts 에서 registerThreadsRepliesSweep() 호출) ──

export const threadsRepliesSweepAdapter: ListResumeSweepAdapter = {
  name: "threads-replies",
  async listActive(): Promise<ActiveJobRef[]> {
    const job = await readAnswerJob();
    return job?.status === "running" ? [{ id: job.id, updatedAt: job.updatedAt }] : [];
  },
  resume(id) {
    void runAnswerJob(id);
  },
};

export function registerThreadsRepliesSweep(): void {
  registerSweepAdapter(threadsRepliesSweepAdapter);
}
