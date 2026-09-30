// 주간 학습 잡 — 팩마다 하나: backpass 전체 패스 → 주인 패턴 분석 → private/review.json.
//
// fire-and-forget 3종 세트 (AGENTS.md):
//   ① 고아 자동 재개: GET(learningOverview)·주기 스윕이 "running 인데 이 프로세스에서 안 돌고 하트비트가 끊긴" 잡을
//      끝난 단계는 건너뛰고 다시 돌린다(최대 MAX_ATTEMPTS).
//   ② 부분 저장: backpass 가 끝나면 패턴 없이 카드부터 review.json 에 저장(partial) → 패턴이 끝나면 덮어쓴다.
//   ③ 하드 타임아웃: 잡 전체 40분(PERSONA_LEARNING_TIMEOUT_MS). 넘으면 backpass·Claude 자식 프로세스 그룹째 죽인다.
// 하트비트: 20초마다 updatedAt 과 마지막 진행 줄을 쓴다.

import { randomUUID } from "node:crypto";
import { registerSweepAdapter } from "@/lib/jobs/sweep";
import { runWithPersonaConfig } from "@/lib/personas/context";
import { readGateRules } from "@/lib/personas/gate-rules";
import type { PersonaConfig } from "@/lib/personas/model";
import { listPersonaIds, readPersona } from "@/lib/personas/registry";
import { readReview, writeReview, type LearningReview } from "./apply";
import {
  backpassConfig,
  ensureBackpassConfig,
  learningBudget,
  learningPaths,
  readEvidenceSummary,
  readJsonFile,
  readProposal,
  pruneForeignEvidence,
  readText,
  runBackpass,
  writeJsonAtomic,
  type BackpassProposal,
} from "./backpass";
import { analyzePatterns, buildCards, type PatternAnalysis, type ReviewCard } from "./patterns";
import { ruleHeatmap, unitSnapshot, type RuleRow } from "./rules";
import { readReplyLog } from "./reply-log";
import { learningStats, type LearningStats } from "./stats";

export type LearningPhase = "config" | "backpass" | "patterns";
const PHASES: readonly LearningPhase[] = ["config", "backpass", "patterns"];

export interface LearningJob {
  id: string;
  persona: string;
  status: "running" | "done" | "failed";
  phase: LearningPhase | "done";
  /** 끝난 단계 — 재개 때 건너뛴다 */
  done: LearningPhase[];
  startedAt: string;
  /** 하트비트 */
  updatedAt: string;
  deadlineAt: string;
  attempt: number;
  progress: string | null;
  error: string | null;
  finishedAt: string | null;
  timings: { backpassMs?: number; patternsMs?: number; totalMs?: number };
}

const HEARTBEAT_MS = 20_000;
/** 하트비트 간격보다 넉넉히 길어야 한다 (첫 컴파일·느린 디스크에 멀쩡한 잡을 고아로 오판하지 않게) */
const ORPHAN_MS = 3 * 60_000;
const MAX_ATTEMPTS = 2;
const DEFAULT_TIMEOUT_MS = 40 * 60_000;

/** 양수·유한만 받는다 (Number(x) || 기본값 금지) */
export function envPositiveMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const learningTimeoutMs = () => envPositiveMs(process.env.PERSONA_LEARNING_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

// ── 잡 파일 ─────────────────────────────────────────────

export async function readJob(id: string): Promise<LearningJob | null> {
  const job = await readJsonFile<LearningJob>(learningPaths(id).job);
  return job && typeof job.id === "string" ? job : null;
}

function jobLocks(): Map<string, Promise<unknown>> {
  const g = globalThis as typeof globalThis & { __personaLearningJobLocks?: Map<string, Promise<unknown>> };
  g.__personaLearningJobLocks ??= new Map();
  return g.__personaLearningJobLocks;
}

/** 같은 잡일 때만 고쳐 쓴다(하트비트와 단계 갱신이 겹쳐도 한 줄로). */
async function patchJob(id: string, jobId: string, fn: (job: LearningJob) => LearningJob): Promise<LearningJob | null> {
  const locks = jobLocks();
  const run = (locks.get(id) ?? Promise.resolve()).then(async () => {
    const job = await readJob(id);
    if (!job || job.id !== jobId) return null;
    const next = { ...fn(job), updatedAt: new Date().toISOString() };
    await writeJsonAtomic(learningPaths(id).job, next);
    return next;
  });
  locks.set(id, run.catch(() => undefined));
  return run;
}

function running(): Set<string> {
  const g = globalThis as typeof globalThis & { __personaLearningRunning?: Set<string> };
  g.__personaLearningRunning ??= new Set();
  return g.__personaLearningRunning;
}

export function isOrphan(job: LearningJob, inProcess: boolean, now = Date.now()): boolean {
  return job.status === "running" && !inProcess && now - Date.parse(job.updatedAt) > ORPHAN_MS;
}

// ── 단계 ───────────────────────────────────────────────

interface RunCtx {
  persona: PersonaConfig;
  job: LearningJob;
  signal: AbortSignal;
  deadlineMs: number;
  progress: (line: string) => void;
}

function emptyBackpassInfo(error?: string): LearningReview["backpass"] {
  return { ran: false, generatedAt: null, transcripts: 0, positive: 0, negative: 0, gapClusters: 0, edits: 0, violations: [], notes: [], ...(error ? { error } : {}) };
}

function backpassInfo(p: BackpassProposal | null, error?: string): LearningReview["backpass"] {
  if (!p) return emptyBackpassInfo(error);
  const stats: BackpassProposal["stats"] = Object.assign({ transcripts: 0, positive: 0, negative: 0, gapClusters: 0 }, p.stats);
  return {
    ...emptyBackpassInfo(error),
    ran: true,
    generatedAt: p.generatedAt,
    transcripts: stats.transcripts,
    positive: stats.positive,
    negative: stats.negative,
    gapClusters: stats.gapClusters,
    edits: p.edits.length,
    violations: p.violations ?? [],
    notes: p.notes ?? [],
  };
}

/** 이번 실행이 만든 제안만 믿는다 (지난주 proposal.json 을 이번 주 것으로 착각하지 않게) */
async function freshProposal(id: string, since: string): Promise<BackpassProposal | null> {
  const p = await readProposal(id);
  return p && Date.parse(p.generatedAt) >= Date.parse(since) ? p : null;
}

async function saveReview(ctx: RunCtx, patch: Partial<LearningReview> & { cards: ReviewCard[] }): Promise<void> {
  const prev = await readReview(ctx.persona.id);
  const base: LearningReview = prev?.generatedAt && prev.generatedAt >= ctx.job.startedAt
    ? prev
    : { version: 1, persona: ctx.persona.id, generatedAt: new Date().toISOString(), partial: true, backpass: emptyBackpassInfo(), rulesSnapshot: {}, cards: [], timings: {} };
  await writeReview(ctx.persona.id, { ...base, ...patch, generatedAt: new Date().toISOString() });
}

async function cardsFor(ctx: RunCtx, proposal: BackpassProposal | null, analysis: PatternAnalysis): Promise<ReviewCard[]> {
  return buildCards({
    persona: ctx.persona,
    proposal,
    patterns: analysis.patterns,
    notes: analysis.notes,
    entries: await readReplyLog(ctx.persona.id),
    rulebookText: await readText(learningPaths(ctx.persona.id).rulebook),
    minEvidence: Number(backpassConfig(ctx.persona.id).minGapEvidence),
    gateRules: await readGateRules(ctx.persona.id),
  });
}

async function phaseBackpass(ctx: RunCtx): Promise<Partial<LearningJob["timings"]>> {
  const started = Date.now();
  const p = learningPaths(ctx.persona.id);
  const snapshot = unitSnapshot(await readText(p.rulebook));
  await pruneForeignEvidence(ctx.persona.id);
  let error: string | undefined;
  try {
    const run = await runBackpass(p.pack, { timeoutMs: Math.max(1, ctx.deadlineMs - Date.now()), signal: ctx.signal, onLine: ctx.progress });
    if (run.code !== 0) error = `backpass 종료 코드 ${run.code}: ${run.stderrTail.slice(-400)}`;
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    error = e instanceof Error ? e.message : String(e);
  }
  const proposal = await freshProposal(ctx.persona.id, ctx.job.startedAt);
  const backpassMs = Date.now() - started;
  await saveReview(ctx, { partial: true, backpass: backpassInfo(proposal, error), rulesSnapshot: snapshot, cards: await cardsFor(ctx, proposal, { patterns: [], notes: [] }), timings: { backpassMs } });
  return { backpassMs };
}

async function phasePatterns(ctx: RunCtx): Promise<Partial<LearningJob["timings"]>> {
  const started = Date.now();
  const id = ctx.persona.id;
  const proposal = await freshProposal(id, ctx.job.startedAt);
  const review = await readReview(id);
  let analysis: PatternAnalysis = { patterns: [], notes: [] };
  let patternsError: string | undefined;
  try {
    analysis = await analyzePatterns(
      {
        persona: ctx.persona,
        entries: await readReplyLog(id),
        proposal,
        summary: await readEvidenceSummary(id),
        rulebookText: await readText(learningPaths(id).rulebook),
        safetyText: await readText(learningPaths(id).safety),
      },
      { deadlineMs: ctx.deadlineMs, signal: ctx.signal }
    );
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    patternsError = e instanceof Error ? e.message : String(e);
  }
  const patternsMs = Date.now() - started;
  await saveReview(ctx, {
    partial: Boolean(patternsError),
    patternsError,
    cards: await cardsFor(ctx, proposal, analysis),
    timings: { ...(review?.timings ?? {}), patternsMs },
  });
  return { patternsMs };
}

async function runPhase(ctx: RunCtx, phase: LearningPhase): Promise<Partial<LearningJob["timings"]>> {
  if (phase === "config") {
    await ensureBackpassConfig(ctx.persona.id);
    return {};
  }
  return phase === "backpass" ? phaseBackpass(ctx) : phasePatterns(ctx);
}

// ── 실행 ───────────────────────────────────────────────

async function runPhases(ctx: RunCtx): Promise<void> {
  const { id } = ctx.job;
  for (const phase of PHASES.filter((p) => !ctx.job.done.includes(p))) {
    await patchJob(ctx.persona.id, id, (j) => ({ ...j, phase, progress: null }));
    const timing = await runPhase(ctx, phase);
    await patchJob(ctx.persona.id, id, (j) => ({ ...j, done: [...j.done, phase], timings: { ...j.timings, ...timing } }));
  }
  // 한쪽만 실패하면 남은 쪽 카드를 보여주고 끝(done). 둘 다 실패하면 잡을 실패로 닫는다.
  const review = await readReview(ctx.persona.id);
  if (review?.backpass.error && review.patternsError) {
    throw new Error(`backpass·패턴 분석 둘 다 실패: ${review.backpass.error.slice(0, 160)} / ${review.patternsError.slice(0, 160)}`);
  }
}

function startHeartbeat(ctx: { persona: PersonaConfig; job: LearningJob }, last: { line: string | null }): ReturnType<typeof setInterval> {
  return setInterval(() => {
    void patchJob(ctx.persona.id, ctx.job.id, (j) => ({ ...j, progress: last.line ?? j.progress })).catch(() => undefined);
  }, HEARTBEAT_MS);
}

async function finishJob(persona: PersonaConfig, job: LearningJob, error: string | null): Promise<void> {
  const now = new Date().toISOString();
  await patchJob(persona.id, job.id, (j) => ({
    ...j,
    status: error ? "failed" : "done",
    phase: error ? j.phase : "done",
    error,
    finishedAt: now,
    timings: { ...j.timings, totalMs: Date.parse(now) - Date.parse(j.startedAt) },
  }));
}

async function executeJob(persona: PersonaConfig, job: LearningJob): Promise<void> {
  running().add(persona.id);
  const controller = new AbortController();
  const deadlineMs = Date.parse(job.deadlineAt);
  const hardStop = setTimeout(() => controller.abort(), Math.max(0, deadlineMs - Date.now()));
  const last = { line: null as string | null };
  const beat = startHeartbeat({ persona, job }, last);
  let error: string | null = null;
  try {
    await runPhases({ persona, job, signal: controller.signal, deadlineMs, progress: (l) => (last.line = l) });
  } catch (e) {
    error = controller.signal.aborted ? `시간 초과 (${Math.round(learningTimeoutMs() / 60000)}분)` : e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(hardStop);
    clearInterval(beat);
    await finishJob(persona, job, error).catch(() => undefined);
    running().delete(persona.id);
  }
}

function launch(persona: PersonaConfig, job: LearningJob): void {
  void runWithPersonaConfig(persona, () => executeJob(persona, job));
}

function newJob(persona: PersonaConfig): LearningJob {
  const now = Date.now();
  return {
    id: randomUUID(),
    persona: persona.id,
    status: "running",
    phase: "config",
    done: [],
    startedAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + learningTimeoutMs()).toISOString(),
    attempt: 1,
    progress: null,
    error: null,
    finishedAt: null,
    timings: {},
  };
}

/** 이미 돌고 있으면 그 잡을, 아니면 새 잡을 띄우고 돌려준다. */
export async function startLearningRun(persona: PersonaConfig): Promise<{ job: LearningJob; started: boolean }> {
  const current = await readJob(persona.id);
  const inProcess = running().has(persona.id);
  if (current?.status === "running" && (inProcess || !isOrphan(current, inProcess))) return { job: current, started: false };
  const job = newJob(persona);
  await writeJsonAtomic(learningPaths(persona.id).job, job);
  launch(persona, job);
  return { job, started: true };
}

/** 고아 잡이면 끝난 단계를 건너뛰고 다시 띄운다. 재개 한도를 넘으면 실패로 닫는다. */
export async function resumeIfOrphan(persona: PersonaConfig): Promise<LearningJob | null> {
  const job = await readJob(persona.id);
  if (!job || !isOrphan(job, running().has(persona.id))) return job;
  if (job.attempt >= MAX_ATTEMPTS) {
    return patchJob(persona.id, job.id, (j) => ({ ...j, status: "failed", error: "서버가 멈춰 잡이 끊겼고, 다시 시도 한도를 넘었어요.", finishedAt: new Date().toISOString() }));
  }
  const resumed = await patchJob(persona.id, job.id, (j) => ({
    ...j,
    attempt: j.attempt + 1,
    deadlineAt: new Date(Date.now() + learningTimeoutMs()).toISOString(),
    progress: "끊긴 잡을 다시 시작함",
  }));
  if (resumed) launch(persona, resumed);
  return resumed;
}

/** 주기 스윕용 (instrumentation 에서 registerPersonaLearningSweep() 한 줄로 켠다). */
export function registerPersonaLearningSweep(): void {
  registerSweepAdapter({
    name: "persona-learning",
    sweep: async () => {
      for (const id of await listPersonaIds()) await resumeIfOrphan(await readPersona(id));
    },
  });
}

// ── 화면용 한 번에 읽기 (GET) ──────────────────────────────

export interface LearningOverview {
  cards: ReviewCard[];
  rules: RuleRow[];
  stats: LearningStats;
  job: LearningJob | null;
  lastRunAt: string | null;
  budget: { tokens: number; cap: number };
  backpass: LearningReview["backpass"] | null;
  partial: boolean;
  patternsError: string | null;
}

function reviewParts(review: LearningReview | null) {
  if (!review) return { cards: [], lastRunAt: null, backpass: null, partial: false, patternsError: null, snapshot: null };
  const snapshot = Object.keys(review.rulesSnapshot ?? {}).length ? review.rulesSnapshot : null;
  return {
    cards: review.cards,
    lastRunAt: review.generatedAt,
    backpass: review.backpass,
    partial: review.partial,
    patternsError: review.patternsError ?? null,
    snapshot,
  };
}

export async function learningOverview(persona: PersonaConfig): Promise<LearningOverview> {
  const id = persona.id;
  const job = await resumeIfOrphan(persona);
  const [review, summary, rulebook, entries] = await Promise.all([
    readReview(id),
    readEvidenceSummary(id),
    readText(learningPaths(id).rulebook),
    readReplyLog(id),
  ]);
  const { snapshot, ...parts } = reviewParts(review);
  const stats = learningStats(entries, rulebook, learningBudget(id));
  return {
    ...parts,
    rules: ruleHeatmap(rulebook, summary?.instructions ?? [], snapshot),
    stats,
    job,
    budget: { tokens: stats.rulebook.tokens, cap: stats.rulebook.budget },
  };
}
