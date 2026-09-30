// 보낸 결과 기록 턴 — 답 하나의 Claude 세션(팩 폴더)에 "주인이 실제로 보낸 답"을 이어 써서
// backpass 가 그 대화를 학습 재료로 읽게 한다 (docs/reply-persona-design.md 4-2·4-4).
// 보내기를 막지 않는다: 보낼 때는 기록 한 줄(outcome: pending)만 남기고, 유예(REPLY_OUTCOME_DELAY_MS, 기본 10분)가
// 지나면 스윕이 하나씩 턴을 쓴다. 유예 동안 주인이 "학습에서 빼기"를 누르면 턴을 쓰지 않는다(시안 픽 15).
//
// fire-and-forget 3종 (AGENTS.md):
//   ① 고아 재개: 스윕이 모든 팩에서 pending(유예 지남)·failed(프로세스당 3회, 10분 간격)를 줍는다.
//      팩 이름을 몰라도 되도록 기록 파일이 상태의 정본이다. 서버가 죽어도 줄이 pending 으로 남아 다시 돈다.
//   ② 부분 저장: 턴 하나가 끝날 때마다 그 줄의 outcome 을 바로 적는다.
//   ③ 하드 타임아웃: REPLY_OUTCOME_TIMEOUT_MS (CLI 자식 프로세스 묶음 종료는 claude-cli 가 한다).
import { open, stat, unlink, utimes } from "fs/promises";
import path from "path";
import { runClaudeCLI } from "@/lib/ai/claude-cli";
import { registerSweepAdapter, type SelfSweepAdapter } from "@/lib/jobs/sweep";
import { envMs } from "@/lib/threads-replies/storage";
import { currentPersona } from "../context";
import type { PersonaId } from "../model";
import { listPersonaIds, packDir, packPrivateDir } from "../registry";
import { readReplyLog, updateReplyLogWhere, type ReplyLogEntry, type ReplyOutcome } from "./reply-log";

const DEFAULT_DELAY_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 120_000;
/** CLI 슬롯 대기까지 합친 전체 상한 여유 */
const SLOT_WAIT_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const RETRY_GAP_MS = 10 * 60 * 1000;
const SWEEP_EVERY_MS = 60_000;

export function outcomeDelayMs(): number {
  return envMs("REPLY_OUTCOME_DELAY_MS", DEFAULT_DELAY_MS);
}

export function outcomeTimeoutMs(): number {
  return envMs("REPLY_OUTCOME_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
}

function outcomeModel(): string {
  return process.env.REPLY_OUTCOME_MODEL?.trim() || "sonnet";
}

// ── 달라진 점 (코드 계산, 모델 안 부름) ──

export interface ReplyDiff {
  lenDraft: number;
  lenFinal: number;
  removed: string[];
  added: string[];
  endingDraft: string;
  endingFinal: string;
  emojiDelta: number;
}

const chars = (s: string) => Array.from(s).length;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** 문장 나누기: 줄바꿈, 또는 마침표·물음표·느낌표·말줄임 뒤 공백. */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?…])\s+/u)
    .map(squash)
    .filter(Boolean);
}

/** 끝맺음 = 끝에 붙은 문장부호·ㅋㅎ·이모지 묶음. 없으면 마지막 글자 (말투 "요"↔"어" 같은 변화). */
export function endingOf(text: string): string {
  const t = text.trim();
  const tail = /(?:[ㄱ-ㅎㅏ-ㅣ]|[^\p{L}\p{N}\s])+$/u.exec(t);
  return tail ? tail[0] : Array.from(t).at(-1) ?? "";
}

export function countEmoji(text: string): number {
  return text.match(/\p{Extended_Pictographic}/gu)?.length ?? 0;
}

export function diffReply(aiDraft: string, final: string): ReplyDiff {
  const before = splitSentences(aiDraft);
  const after = splitSentences(final);
  return {
    lenDraft: chars(aiDraft.trim()),
    lenFinal: chars(final.trim()),
    removed: before.filter((s) => !after.includes(s)),
    added: after.filter((s) => !before.includes(s)),
    endingDraft: endingOf(aiDraft),
    endingFinal: endingOf(final),
    emojiDelta: countEmoji(final) - countEmoji(aiDraft),
  };
}

const MAX_QUOTED = 3;
const clip = (s: string) => (chars(s) > 40 ? `${Array.from(s).slice(0, 40).join("")}…` : s);
const quoteList = (label: string, list: string[]) =>
  list.length ? [`${label} ${list.slice(0, MAX_QUOTED).map((s) => `"${clip(s)}"`).join(", ")}${list.length > MAX_QUOTED ? ` 외 ${list.length - MAX_QUOTED}개` : ""}`] : [];

/** "길이 58→19자 · 뺀 문장 "…" · 더한 문장 "…" · 끝맺음 "." → "ㅎㅎ" · 이모지 +1" */
export function describeDiff(d: ReplyDiff): string {
  const parts = [`길이 ${d.lenDraft}→${d.lenFinal}자`, ...quoteList("뺀 문장", d.removed), ...quoteList("더한 문장", d.added)];
  if (d.endingDraft !== d.endingFinal) parts.push(`끝맺음 "${d.endingDraft}" → "${d.endingFinal}"`);
  if (d.emojiDelta !== 0) parts.push(`이모지 ${d.emojiDelta > 0 ? "+" : ""}${d.emojiDelta}`);
  return parts.join(" · ");
}

const ASK_ONE_LINE = '한 줄로만 답해: "어긴 규칙: <규칙책 문장 인용>" 또는 "없던 규칙: <한 문장>"';

/** 결과 기록 턴 문안. 초안 그대로면 한 줄, 고쳤으면 보낸 답 + 달라진 점 + 이유 + 한 줄 요청. */
export function buildOutcomeText(entry: Pick<ReplyLogEntry, "aiDraft" | "final" | "reason">): string {
  const final = (entry.final ?? "").trim();
  if (entry.aiDraft !== null && entry.aiDraft.trim() === final) return "[보낸 결과] 초안 그대로 보냄";
  const lines = [`[보낸 결과] 주인이 이 댓글에 실제로 보낸 답: «${final}»`];
  if (entry.aiDraft !== null) lines.push(`초안과 달라진 점(코드 계산): ${describeDiff(diffReply(entry.aiDraft, final))}`);
  if (entry.reason?.trim()) lines.push(`주인이 남긴 이유: ${entry.reason.trim()}`);
  lines.push(ASK_ONE_LINE);
  return lines.join("\n");
}

export const EXCLUDE_TURN_TEXT = "[학습 제외] 이 답은 특수한 상황이라 규칙으로 삼지 않는다.";

export function buildExcludeText(reason: string | null): string {
  return reason?.trim() ? `${EXCLUDE_TURN_TEXT}\n주인이 남긴 이유: ${reason.trim()}` : EXCLUDE_TURN_TEXT;
}

// ── 턴 쓰기 ──

/** 그 답의 세션에 한 턴 이어 쓴다 (작업 폴더 = 팩, sonnet · low · 하드 타임아웃). 모델의 한 줄 답을 돌려준다. */
export function resumeReplySession(personaId: PersonaId, sessionId: string, text: string): Promise<string> {
  const timeoutMs = outcomeTimeoutMs();
  return runClaudeCLI(text, {
    workspace: { dir: packDir(personaId), sessionId, resume: true },
    model: outcomeModel(),
    effort: "low",
    timeoutMs,
    deadlineMs: Date.now() + timeoutMs + SLOT_WAIT_MS,
    requireClaude: true,
  });
}

// 같은 줄에 턴이 두 번 돌지 않게 + 재시도 횟수 (hot reload 에도 하나).
interface RunState {
  running: Set<string>;
  attempts: Map<string, { count: number; lastAt: number }>;
}
function runState(): RunState {
  const g = globalThis as typeof globalThis & { __replyOutcomeRuns?: RunState };
  g.__replyOutcomeRuns ??= { running: new Set(), attempts: new Map() };
  return g.__replyOutcomeRuns;
}

const keyOf = (personaId: PersonaId, e: Pick<ReplyLogEntry, "replyId" | "at">) => `${personaId}:${e.replyId}:${e.at}`;
const sameEntry = (e: Pick<ReplyLogEntry, "replyId" | "at">) => (x: ReplyLogEntry) => x.replyId === e.replyId && x.at === e.at;

export function isOutcomeRunning(personaId: PersonaId, entry: Pick<ReplyLogEntry, "replyId" | "at">): boolean {
  return runState().running.has(keyOf(personaId, entry));
}

function canRetry(key: string, now: number): boolean {
  const a = runState().attempts.get(key);
  return !a || (a.count < MAX_ATTEMPTS && now - a.lastAt >= RETRY_GAP_MS);
}

function noteAttempt(key: string): void {
  const a = runState().attempts.get(key);
  runState().attempts.set(key, { count: (a?.count ?? 0) + 1, lastAt: Date.now() });
}

/** 줄 하나를 한 번 처리: 학습 대상이면 결과 턴, 이미 빼기로 바뀌었으면 제외 턴. 끝나면 outcome 을 적는다. */
async function runTurnFor(personaId: PersonaId, entry: ReplyLogEntry): Promise<ReplyOutcome> {
  const key = keyOf(personaId, entry);
  const state = runState();
  if (state.running.has(key) || !entry.sessionId) return entry.outcome;
  state.running.add(key);
  noteAttempt(key);
  try {
    const text = entry.learn ? buildOutcomeText(entry) : buildExcludeText(entry.reason);
    await resumeReplySession(personaId, entry.sessionId, text);
    const after = await updateReplyLogWhere(personaId, sameEntry(entry), { outcome: "done" });
    // 턴이 도는 사이 주인이 "학습에서 빼기"를 눌렀으면 바로 제외 턴을 덧붙인다
    if (entry.learn && after && !after.learn) await resumeReplySession(personaId, entry.sessionId, buildExcludeText(after.reason));
    return "done";
  } catch {
    await updateReplyLogWhere(personaId, sameEntry(entry), { outcome: "failed" }).catch(() => null);
    return "failed";
  } finally {
    state.running.delete(key);
  }
}

/** 지금 턴을 써야 하는 줄인가. pending 은 유예가 지났을 때(제외 턴은 바로), failed 는 재시도 여유가 있을 때. */
export function isDue(personaId: PersonaId, entry: ReplyLogEntry, now: number, delayMs = outcomeDelayMs()): boolean {
  if (!entry.sessionId || !entry.final) return false;
  if (entry.outcome === "pending") return !entry.learn || Date.parse(entry.at) + delayMs <= now;
  return entry.outcome === "failed" && canRetry(keyOf(personaId, entry), now);
}

// 다른 서버 프로세스(:3005 build 등)와 같은 팩을 동시에 쓰지 않게 팩마다 잠금 파일. 오래된 잠금은 버린다.
function lockPath(personaId: PersonaId): string {
  return path.join(packPrivateDir(personaId), ".reply-outcome.lock");
}

async function tryLock(file: string, staleMs: number): Promise<boolean> {
  try {
    await (await open(file, "wx")).close();
    return true;
  } catch {
    const age = await stat(file).then((s) => Date.now() - s.mtimeMs).catch(() => 0);
    if (age <= staleMs) return false;
    await unlink(file).catch(() => undefined);
    return tryLock(file, Number.POSITIVE_INFINITY);
  }
}

/** 한 팩의 밀린 턴을 하나씩 쓴다. 쓴 턴 수를 돌려준다. */
export async function sweepPersonaOutcomes(personaId: PersonaId, now = Date.now()): Promise<number> {
  const due = (await readReplyLog(personaId)).filter((e) => isDue(personaId, e, now));
  if (due.length === 0) return 0;
  const lock = lockPath(personaId);
  if (!(await tryLock(lock, outcomeTimeoutMs() * 2 + SLOT_WAIT_MS))) return 0;
  let ran = 0;
  try {
    for (const entry of due) {
      await utimes(lock, new Date(), new Date()).catch(() => undefined); // 긴 스윕 중에도 잠금이 낡지 않게
      if ((await runTurnFor(personaId, entry)) === "done") ran++;
    }
  } finally {
    await unlink(lock).catch(() => undefined);
  }
  return ran;
}

/** 모든 팩을 한 번 쓸어 본다. 한 팩의 실패가 다른 팩을 막지 않는다. 겹쳐 돌지 않는다. */
export async function sweepOutcomes(now = Date.now()): Promise<number> {
  const g = globalThis as typeof globalThis & { __replyOutcomeSweeping?: boolean };
  if (g.__replyOutcomeSweeping) return 0;
  g.__replyOutcomeSweeping = true;
  let ran = 0;
  try {
    for (const id of await listPersonaIds()) ran += await sweepPersonaOutcomes(id, now).catch(() => 0);
  } finally {
    g.__replyOutcomeSweeping = false;
  }
  return ran;
}

// ── 학습에서 빼기 / 다시 넣기 (PATCH /api/threads-replies/[id]/learn) ──
// learn:false + pending = "제외 턴을 써야 함" (결과 턴이 이미 돈 뒤 빼기를 누른 경우). 스윕이 바로 쓴다.

export type LearnToggleResult =
  | { ok: true; entry: ReplyLogEntry; excludeTurn: "queued" | "none" }
  | { ok: false; status: 404 | 409; error: string };

/** 빼기: 아직 안 돈 턴은 취소, 도는 중이면 러너가 끝난 뒤 제외 턴을 붙이고, 이미 돌았으면 제외 턴을 건다. */
function outcomeWhenOff(personaId: PersonaId, entry: ReplyLogEntry): ReplyOutcome {
  if (isOutcomeRunning(personaId, entry)) return entry.outcome;
  if (entry.outcome === "done" && entry.sessionId) return "pending";
  return entry.outcome === "pending" || entry.outcome === "failed" ? "skipped" : entry.outcome;
}

/** 다시 넣기: 취소됐던 턴은 다시 기다리고, 걸어 둔 제외 턴은 거둔다(결과 턴은 이미 돌았다). */
function outcomeWhenOn(personaId: PersonaId, entry: ReplyLogEntry): ReplyOutcome {
  if (isOutcomeRunning(personaId, entry)) return entry.outcome;
  if (entry.outcome === "skipped" && entry.sessionId && entry.final) return "pending";
  return entry.outcome === "pending" || entry.outcome === "failed" ? "done" : entry.outcome;
}

async function toggle(personaId: PersonaId, entry: ReplyLogEntry, learn: boolean, reason: string | null): Promise<LearnToggleResult> {
  if (learn && entry.gate === "block") return { ok: false, status: 409, error: "안전 관문에 걸린 답은 학습에 넣을 수 없어요." };
  const outcome = learn ? outcomeWhenOn(personaId, entry) : outcomeWhenOff(personaId, entry);
  const next = await updateReplyLogWhere(personaId, sameEntry(entry), { learn, reason, outcome });
  if (!next) return { ok: false, status: 404, error: "학습 기록을 찾지 못했어요." };
  const queued = !learn && outcome === "pending" && entry.outcome === "done";
  if (queued) void sweepPersonaOutcomes(personaId).catch(() => 0); // 1분 스윕을 기다리지 않고 바로
  return { ok: true, entry: next, excludeTurn: queued ? "queued" : "none" };
}

function reasonOf(entry: ReplyLogEntry, reason: string | undefined): string | null {
  if (reason === undefined) return entry.reason;
  return reason.trim().slice(0, 300) || null;
}

/** 그 댓글의 마지막 기록을 학습에 넣거나 뺀다. reason 을 안 주면 원래 이유를 둔다. */
export async function setReplyLearning(
  replyId: string,
  learn: boolean,
  reason?: string,
  personaId: PersonaId = currentPersona().id
): Promise<LearnToggleResult> {
  const entry = (await readReplyLog(personaId)).filter((e) => e.replyId === replyId).at(-1);
  if (!entry) return { ok: false, status: 404, error: "이 답의 학습 기록이 없어요." };
  const nextReason = reasonOf(entry, reason);
  if (entry.learn !== learn) return toggle(personaId, entry, learn, nextReason);
  const same = await updateReplyLogWhere(personaId, sameEntry(entry), { reason: nextReason });
  return { ok: true, entry: same ?? entry, excludeTurn: "none" };
}

// ── 스윕 등록 ──
// ① instrumentation.ts 에서 registerReplyOutcomeSweep() 하면 서버 시작 스윕·1분 스윕에 들어간다.
// ② 그 줄이 없어도, 이 모듈을 처음 import 한 프로세스(보내기·학습 라우트)가 자기 1분 타이머를 띄운다.
//    라우트 번들과 instrumentation 번들은 모듈 인스턴스가 다를 수 있어 상태는 globalThis 에 둔다.
export const replyOutcomeSweepAdapter: SelfSweepAdapter = {
  name: "reply-outcomes",
  sweep: async () => {
    await sweepOutcomes();
  },
};

export function registerReplyOutcomeSweep(): void {
  registerSweepAdapter(replyOutcomeSweepAdapter);
}

function shouldAutoStart(): boolean {
  if (process.env.VITEST || process.env.NODE_ENV === "test") return false;
  return process.env.NEXT_PHASE !== "phase-production-build";
}

export function startReplyOutcomeTimer(): void {
  if (!shouldAutoStart()) return;
  const g = globalThis as typeof globalThis & { __replyOutcomeTimer?: { run: () => Promise<unknown>; timer?: ReturnType<typeof setInterval> } };
  g.__replyOutcomeTimer ??= { run: sweepOutcomes };
  const state = g.__replyOutcomeTimer;
  state.run = sweepOutcomes; // hot reload 뒤에는 새 코드로 돈다
  if (state.timer) return;
  state.timer = setInterval(() => void state.run().catch(() => undefined), SWEEP_EVERY_MS);
  unref(state.timer);
  unref(setTimeout(() => void state.run().catch(() => undefined), 5_000));
}

/** 타이머가 프로세스를 붙들지 않게 (Node 타이머만 unref 가 있다). */
function unref(timer: unknown): void {
  (timer as { unref?: () => void }).unref?.();
}

startReplyOutcomeTimer();
