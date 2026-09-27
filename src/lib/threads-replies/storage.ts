// 스레드 댓글 답하기 — 디스크 영속화. 경로 계산은 여기에만 둔다 (AGENTS.md 저장 규칙).
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { createRepliesLedger, type ThreadsRepliesLedger } from "./model";

export function threadsRepliesDir(): string {
  return process.env.THREADS_REPLIES_DIR ?? path.join(process.cwd(), "data", "threads-replies");
}

export function ledgerPath(): string {
  return path.join(threadsRepliesDir(), "ledger.json");
}

export function answerJobPath(): string {
  return path.join(threadsRepliesDir(), "answer-job.json");
}

/** 원문 형광 캡처 저장 폴더 (public/ 아래라 /threads-evidence/... 로 바로 보인다). */
export function evidenceDir(): string {
  return process.env.THREADS_EVIDENCE_DIR ?? path.join(process.cwd(), "public", "threads-evidence");
}

export function evidenceReplyDir(replyId: string): string {
  return path.join(evidenceDir(), replyId.replace(/[^A-Za-z0-9_-]/g, ""));
}

/** env 시간값: 양수·유한일 때만 쓰고 아니면 기본값 (AGENTS.md: `Number(x) || 기본값` 금지). */
export function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT";
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readRepliesLedger(filePath = ledgerPath()): Promise<ThreadsRepliesLedger> {
  const parsed = await readJson<Partial<ThreadsRepliesLedger>>(filePath);
  if (!parsed) return createRepliesLedger();
  return { posts: parsed.posts ?? [], replies: parsed.replies ?? [], sync: parsed.sync ?? {} };
}

export async function writeRepliesLedger(ledger: ThreadsRepliesLedger, filePath = ledgerPath()): Promise<void> {
  await writeJson(filePath, ledger);
}

// 원장 쓰기는 한 줄로 세운다 — 동기화와 초안 잡이 같은 파일을 읽고-고치고-쓰기 때문.
// hot reload 재평가에도 하나의 줄을 쓰도록 globalThis 에 둔다.
function ledgerLock(): { tail: Promise<unknown> } {
  const g = globalThis as typeof globalThis & { __threadsRepliesLedgerLock?: { tail: Promise<unknown> } };
  g.__threadsRepliesLedgerLock ??= { tail: Promise.resolve() };
  return g.__threadsRepliesLedgerLock;
}

/** 최신 원장을 읽어 fn 으로 고친 뒤 저장. 동시에 하나만 돈다. fn 이 던지면 저장하지 않는다. */
export async function updateRepliesLedger(
  fn: (ledger: ThreadsRepliesLedger) => ThreadsRepliesLedger
): Promise<ThreadsRepliesLedger> {
  const lock = ledgerLock();
  const run = lock.tail.then(async () => {
    const next = fn(await readRepliesLedger());
    await writeRepliesLedger(next);
    return next;
  });
  lock.tail = run.catch(() => undefined);
  return run;
}

// ── 답 초안 잡 ─────────────────────────────────────────────

export interface AnswerJob {
  id: string;
  /** 사람이 읽는 범위 표기 ("all" · "questions" · "post:<id>" · "replies") */
  scope: string;
  replyIds: string[];
  done: string[];
  failed: { replyId: string; error: string }[];
  status: "running" | "done" | "stopped";
  createdAt: string;
  /** heartbeat — 처리 중에도 주기적으로 갱신 (sweep stale 판정용) */
  updatedAt: string;
  /** 지금 처리 중인 댓글 */
  current?: string;
}

export async function readAnswerJob(filePath = answerJobPath()): Promise<AnswerJob | null> {
  const parsed = await readJson<Partial<AnswerJob>>(filePath);
  if (!parsed?.id || !Array.isArray(parsed.replyIds)) return null;
  const now = new Date().toISOString();
  return {
    id: parsed.id,
    scope: parsed.scope ?? "all",
    replyIds: parsed.replyIds,
    done: parsed.done ?? [],
    failed: parsed.failed ?? [],
    status: parsed.status ?? "done",
    createdAt: parsed.createdAt ?? now,
    updatedAt: parsed.updatedAt ?? now,
    current: parsed.current,
  };
}

export async function writeAnswerJob(job: AnswerJob, filePath = answerJobPath()): Promise<void> {
  await writeJson(filePath, job);
}
