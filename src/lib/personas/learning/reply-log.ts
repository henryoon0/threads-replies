// 답 하나 = 기록 한 줄 — 팩 private/reply-log.jsonl (docs/reply-persona-design.md 4-3, 시안 픽 15).
// 학습 쪽(backpass 다리·패턴·통계)이 이 모양을 그대로 읽는다. 칸 이름·순서를 바꾸면 그쪽도 같이 고친다.
// 한 댓글에 줄이 여러 개일 수 있다(관문 차단 뒤 보내기 등). 고치기(updateReplyLog)는 그 댓글의 마지막 줄을 고친다.
import { appendFile, mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import type { GateResult, ReplyAnswer, ThreadsReply } from "@/lib/threads-replies/model";
import { currentPersona } from "../context";
import type { PersonaId } from "../model";
import { packPrivateDir } from "../registry";

export type ReplyLogAction = "sent" | "sent_edited" | "copied" | "skipped" | "gate_blocked";
export type ReplyOutcome = "pending" | "done" | "failed" | "skipped";

export interface ReplyLogEntry {
  v: 1;
  at: string;
  replyId: string;
  postId: string;
  persona: PersonaId;
  sessionId: string | null;
  action: ReplyLogAction;
  comment: string;
  aiDraft: string | null;
  final: string | null;
  categoryId: string | null;
  editRatio: number | null;
  gate: GateResult["status"] | null;
  learn: boolean;
  reason: string | null;
  outcome: ReplyOutcome;
}

/** 고칠 수 있는 칸 (누가·언제·무엇에 대한 줄인지는 못 바꾼다). */
export type ReplyLogPatch = Partial<Omit<ReplyLogEntry, "v" | "at" | "replyId" | "postId" | "persona">>;

// ── 순수 계산 ──

/** 글자(코드 포인트) 단위 편집 거리. 이모지도 한 글자로 센다. */
export function levenshtein(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

/** 수정 비율 = 편집 거리 / 초안 글자 수 (최소 1). 소수 셋째 자리까지. 모델을 부르지 않는다. */
export function editRatio(aiDraft: string, final: string): number {
  const a = aiDraft.trim();
  const ratio = levenshtein(a, final.trim()) / Math.max(1, Array.from(a).length);
  return Math.round(ratio * 1000) / 1000;
}

/**
 * 비교 기준 초안 = aiDraft (벌을 고르면 그 벌의 AI 원문으로 바뀐다, draft.ts chooseOption).
 * 예전 답처럼 aiDraft 가 없으면 고른 벌의 원문. 주인이 고친 answer.draft 는 쓰지 않는다.
 */
export function aiDraftOf(answer: ReplyAnswer | undefined): string | null {
  if (!answer) return null;
  const chosen = answer.chosen !== undefined ? answer.options?.[answer.chosen] : undefined;
  return answer.aiDraft ?? chosen?.draft ?? null;
}

function categoryOf(answer: ReplyAnswer | undefined): string | null {
  if (!answer || answer.chosen === undefined) return null;
  return answer.options?.[answer.chosen]?.categoryId ?? null;
}

/** API 로 보낸 답: 초안 그대로면 sent, 고쳤거나 AI 초안이 없었으면 sent_edited. */
export function sentAction(aiDraft: string | null, final: string): "sent" | "sent_edited" {
  return aiDraft !== null && aiDraft.trim() === final.trim() ? "sent" : "sent_edited";
}

function ratioOf(aiDraft: string | null, final: string | null): number | null {
  return aiDraft !== null && final !== null ? editRatio(aiDraft, final) : null;
}

export interface ReplyLogInput {
  reply: Pick<ThreadsReply, "id" | "postId" | "text" | "answer">;
  persona: PersonaId;
  action: ReplyLogAction;
  final: string | null;
  gate: GateResult["status"] | null;
  reason?: string | null;
  at?: string;
}

/** 기록 한 줄을 만든다. 관문에 막힌 답은 학습에서 뺀다. 세션이 있고 학습 대상일 때만 결과 기록 턴을 기다린다. */
export function buildReplyLogEntry(input: ReplyLogInput): ReplyLogEntry {
  const answer = input.reply.answer;
  const aiDraft = aiDraftOf(answer);
  const sessionId = answer?.sessionId ?? null;
  const learn = input.gate !== "block" && input.action !== "gate_blocked";
  const final = input.final;
  return {
    v: 1,
    at: input.at ?? new Date().toISOString(),
    replyId: input.reply.id,
    postId: input.reply.postId,
    persona: input.persona,
    sessionId,
    action: input.action,
    comment: input.reply.text,
    aiDraft,
    final,
    categoryId: categoryOf(answer),
    editRatio: ratioOf(aiDraft, final),
    gate: input.gate,
    learn,
    reason: input.reason ?? null,
    outcome: learn && sessionId && final ? "pending" : "skipped",
  };
}

function isEntry(v: unknown): v is ReplyLogEntry {
  const e = v as ReplyLogEntry | null;
  return typeof e === "object" && e !== null && e.v === 1 && typeof e.replyId === "string" && typeof e.at === "string";
}

function parseLine(line: string): ReplyLogEntry | null {
  try {
    const v: unknown = JSON.parse(line);
    return isEntry(v) ? v : null;
  } catch {
    return null;
  }
}

/** JSONL 원문 → 줄들. 깨진 줄은 건너뛴다(파일 전체를 버리지 않는다). */
export function parseReplyLog(raw: string): ReplyLogEntry[] {
  return raw
    .split("\n")
    .map(parseLine)
    .filter((e): e is ReplyLogEntry => e !== null);
}

// ── 디스크 ──

export function replyLogPath(personaId: PersonaId): string {
  return path.join(packPrivateDir(personaId), "reply-log.jsonl");
}

// 같은 파일 쓰기는 한 줄로 (덧붙이기와 다시 쓰기가 섞이지 않게). hot reload 에도 하나.
function lockFor(file: string): { tail: Promise<unknown> } {
  const g = globalThis as typeof globalThis & { __replyLogLocks?: Map<string, { tail: Promise<unknown> }> };
  g.__replyLogLocks ??= new Map();
  let lock = g.__replyLogLocks.get(file);
  if (!lock) {
    lock = { tail: Promise.resolve() };
    g.__replyLogLocks.set(file, lock);
  }
  return lock;
}

function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lock = lockFor(file);
  const run = lock.tail.then(fn);
  lock.tail = run.catch(() => undefined);
  return run;
}

async function readRaw(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return "";
    throw error;
  }
}

export async function appendReplyLog(entry: ReplyLogEntry): Promise<void> {
  const file = replyLogPath(entry.persona);
  await withLock(file, async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
  });
}

/** 기록 한 줄을 만들어 덧붙이고 그 줄을 돌려준다. */
export async function logReply(input: ReplyLogInput): Promise<ReplyLogEntry> {
  const entry = buildReplyLogEntry(input);
  await appendReplyLog(entry);
  return entry;
}

export async function readReplyLog(personaId: PersonaId = currentPersona().id): Promise<ReplyLogEntry[]> {
  return parseReplyLog(await readRaw(replyLogPath(personaId)));
}

/** 그 댓글의 마지막 줄. 없으면 null. */
export async function latestReplyLog(replyId: string, personaId: PersonaId = currentPersona().id): Promise<ReplyLogEntry | null> {
  const entries = await readReplyLog(personaId);
  return entries.filter((e) => e.replyId === replyId).at(-1) ?? null;
}

type PatchInput = ReplyLogPatch | ((entry: ReplyLogEntry) => ReplyLogPatch | null);

function lastMatchIndex(lines: string[], match: (e: ReplyLogEntry) => boolean): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const e = parseLine(lines[i]);
    if (e && match(e)) return i;
  }
  return -1;
}

/**
 * 조건에 맞는 마지막 줄을 고쳐 파일을 다시 쓴다(임시 파일 → 이름 바꾸기). 다른 줄·깨진 줄은 그대로 둔다.
 * patch 가 함수면 최신 줄을 보고 고칠 칸을 정한다(null = 안 고침). 고친 줄을 돌려준다.
 */
export async function updateReplyLogWhere(
  personaId: PersonaId,
  match: (e: ReplyLogEntry) => boolean,
  patch: PatchInput
): Promise<ReplyLogEntry | null> {
  const file = replyLogPath(personaId);
  return withLock(file, async () => {
    const lines = (await readRaw(file)).split("\n").filter((l) => l.trim());
    const index = lastMatchIndex(lines, match);
    if (index < 0) return null;
    const current = parseLine(lines[index]) as ReplyLogEntry;
    const change = typeof patch === "function" ? patch(current) : patch;
    if (!change) return current;
    const next: ReplyLogEntry = { ...current, ...change };
    lines[index] = JSON.stringify(next);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${lines.join("\n")}\n`, "utf8");
    await rename(tmp, file);
    return next;
  });
}

/** 그 댓글의 마지막 줄을 고친다. 기본은 지금 페르소나의 기록. */
export function updateReplyLog(replyId: string, patch: PatchInput, personaId: PersonaId = currentPersona().id): Promise<ReplyLogEntry | null> {
  return updateReplyLogWhere(personaId, (e) => e.replyId === replyId, patch);
}
