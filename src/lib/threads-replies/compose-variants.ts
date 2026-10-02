// 답 버전 미리 쓰기 (2026-09-29 henry: "버튼 하나에 여러 조각이 섞인 버전들이 여러 개, 누르면 바로").
//
// 댓글마다 이 계정의 답 버전(compose-presets: 주인이 조각을 섞는 방식)을 댓글에 맞는 순서로 최대 6벌 미리 써 둔다.
// 화면은 버전 버튼을 누를 때 그 벌의 글을 바로 꺼내 보여 주고, 고르면 POST 로 고른 초안(aiDraft)이 된다.
// 열쇠 = 버전 id. (파일 판 5: 판 4 는 원장의 옛 세션·옛 초안을 이어받아 떠넘기기를 옮겨 적었다. 이제 댓글마다 새 세션으로 쓴다.)
// 파일 판 6 (2026-09-30 henry "다 동일한 결과를 다르게 변형한 느낌"): 판 5 는 첫 벌을 앞 초안으로 주고 같은 세션에 이어 써서
// 나머지 벌이 첫 벌의 조각만 넣고 뺀 글이 됐다. 이제 벌마다 앞 초안 없이 새 세션으로 따로 쓴다. 벌마다 세션을 남겨 고른 뒤 이어 쓴다.
//
// fire-and-forget 3종 세트 (AGENTS.md):
//   ① 고아 자동 재개: requestVersions(목록 GET·변형 GET)와 registerComposeVariantsSweep 이 멈춘 잡을 다시 줄 세운다(멱등).
//   ② 부분 저장: 한 벌 쓸 때마다 팩 private/compose-variants/<댓글>.json 에 저장. 도는 동안 heartbeat 로 updatedAt 을 민다.
//   ③ 하드 타임아웃: 한 벌은 draftFor 안의 THREADS_COMPOSE_TIMEOUT_MS. 댓글 안의 벌은 동시에 쓰므로 댓글 전체도 이 상한 안에 끝난다.
// 열쇠 = 댓글 id + 규칙책(AGENTS.md) git blob sha. 규칙책이 바뀌면 옛 벌은 버리고 다시 쓴다.
// 순서: 댓글 10개를 한꺼번에(THREADS_VARIANTS_PARALLEL, 자기 CLI 칸), 댓글 안의 추천 2벌도 동시에(= CLI 20개), 벌마다 새 세션.
// 범위: 화면이 보내는 "지금 보는 댓글부터 10개"만 (10-02 비용 2 — 예전엔 대기 댓글 전부였다). 주인이 연 댓글은 줄 맨 앞으로 새치기한다.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { runInCliLane } from "@/lib/ai/cli-concurrency";
import { registerSweepAdapter } from "@/lib/jobs/sweep";
import { currentPersona, runWithPersonaConfig } from "@/lib/personas/context";
import type { PersonaConfig } from "@/lib/personas/model";
import type { ProductRef } from "@/lib/personas/products";
import { listPersonaIds, packPrivateDir, packRulebookPath, readPersona } from "@/lib/personas/registry";
import { parseToggles, type ComposeSection, type ComposeToggles, type ToggleSet } from "./compose";
import { COMPOSE_KINDS, PRODUCT_CHANNELS } from "./compose-kinds";
import { MAX_PRESETS } from "./compose-presets";
import { draftFor, saveComposed, suggestForReply } from "./compose-run";
import { isPending, type ThreadsReply } from "./model";
import { readRepliesLedger } from "./storage";

export const MAX_VARIANTS = MAX_PRESETS;
/** 댓글마다 미리 쓰는 벌 수: 추천 2개만 (2026-10-01 henry "토글 2개 정도만 생성, 나머지는 누르면"). 나머지는 누를 때 POST compose 로 쓴다. */
export const PREFETCH_VARIANTS = 2;
const FILE_VERSION = 6;
const HEARTBEAT_MS = 20_000;
const STALE_MS = 3 * 60 * 1000;
/**
 * 버전 쓰기의 단 하나의 입구 (2026-10-02 사고: 입구 4곳이 파일의 planned 를 각자 믿어서, 쌓인 6벌을 새로 쓰기가 전부 다시 썼다).
 * 몇 벌 쓸지는 파일 기록이 아니라 행동이 정한다. 어느 행동이든 한 댓글에 AI 를 MAX_WRITES_PER_JOB 번 넘게 부르지 않는다.
 *   prefetch: 아직 안 쓴 추천 벌만 (다 쓴 댓글은 건너뜀). front 면 줄 맨 앞.
 *   rewrite : 써 둔 벌을 버리고 추천 벌만 다시. 지금 도는 댓글은 busy 로 돌려준다(쓰는 중인 파일을 갈아엎으면 옛 벌이 섞인다).
 *   resume  : 멈춘 잡을 다시 줄 세운다 (스윕).
 * 누를 때 쓰는 한 벌(POST compose)은 여기를 거치지 않고 1번만 쓰고 rememberVariant 로 창고에만 넣는다.
 */
export type VersionAction = "prefetch" | "rewrite" | "resume";

export async function requestVersions(
  replyIds: readonly string[],
  action: VersionAction,
  opts: { front?: boolean } = {}
): Promise<{ queued: string[]; busy: string[] }> {
  if (action !== "rewrite") return { queued: await ensureVariants(replyIds, { front: opts.front }), busy: [] };
  const persona = currentPersona();
  const q = queue();
  const busy = replyIds.filter((id) => q.running.has(`${persona.id}#${id}`));
  const todo = replyIds.filter((id) => !busy.includes(id));
  for (const id of todo) {
    const cur = await readVariantsFile(persona, id);
    if (!cur) continue;
    // 계획은 옛 파일이 아니라 지금 추천에서 다시 뽑는다 (10-02: 어제 추천을 다시 써서 화면이 기다리는 버전이 안 왔다)
    const suggestion = await suggestForReply(id);
    const planned = "error" in suggestion ? cur.planned : planFromPresets(suggestion.presets, suggestion.toggles, PREFETCH_VARIANTS);
    await writeVariantsFile(persona, restartedFile({ ...cur, planned }, new Date().toISOString()));
  }
  return { queued: await ensureVariants(todo, { front: true }), busy };
}

/** 한 잡이 AI 를 부르는 최대 횟수. 어떤 입구·어떤 옛 파일이 와도 이 수를 넘지 않는다. */
export const MAX_WRITES_PER_JOB = PREFETCH_VARIANTS;

/**
 * 이번 잡에서 실제로 쓸 열쇠 (AI 호출 직전의 마지막 관문). 순수.
 * 옛 파일의 planned 가 상한보다 길 때 어떻게 할지가 이 함수의 결정이다.
 */
export function jobKeys(file: VariantsFile, max = MAX_WRITES_PER_JOB): { write: string[]; dropped: string[] } {
  const left = pendingKeys(file);
  // 추천 순서를 믿고 앞에서부터 쓴다 (답이 비는 것보다 덜 쓰는 편이 낫다)
  return { write: left.slice(0, max), dropped: left.slice(max) };
}

/**
 * 새로 쓰기용 파일: 벌·실패·세션을 비우고, 계획은 앞의 추천 PREFETCH_VARIANTS 개만 (10-02 — 눌러서 늘어난 벌까지 전부 다시 쓰던 것).
 * 나머지 버전은 누를 때 다시 쓴다.
 */
export function restartedFile(cur: VariantsFile, now: string): VariantsFile {
  return { ...cur, planned: cur.planned.slice(0, PREFETCH_VARIANTS), status: "running", variants: [], failed: [], sessionId: undefined, updatedAt: now };
}

/** 목록 GET 이 미리 쓰는 댓글 수 상한. 기본은 대기 댓글 전부, 댓글 하나 = 추천 2벌. THREADS_VARIANTS_PREFETCH 로 줄인다. */
export const PREFETCH_COMMENTS = Infinity;

// ── 조합 (순수) ─────────────────────────────────────────────────────

/** 조합 열쇠: 켠 종류를 정해진 순서로, 제품은 경로까지. 예) "principle+product:pharmacy,overseas" */
export function variantKey(set: ToggleSet): string {
  return COMPOSE_KINDS.filter((k) => set.kinds.includes(k))
    .map((k) => (k === "product" ? `product:${PRODUCT_CHANNELS.filter((c) => set.channels.includes(c)).join(",")}` : k))
    .join("+");
}

/** 화면이 보낸 toggles → 열쇠 (틀린 토글이면 null) */
export function keyOfToggles(toggles: unknown): string | null {
  const set = parseToggles(toggles);
  return typeof set === "string" ? null : variantKey(set);
}

/** 미리 쓸 벌 하나: 버전 id · 토글 · 버튼 이름 · 버전 지시 */
export interface PlannedVariant {
  key: string;
  toggles: ComposeToggles;
  name?: string;
  guide?: string;
}

/** 제안된 버전(순서대로) → 미리 쓸 벌 max 개. 버전이 없으면 기본 토글 한 벌. */
export function planFromPresets(
  presets: readonly { id: string; name: string; guide?: string; toggles: ComposeToggles }[],
  fallback: ComposeToggles,
  max = MAX_VARIANTS
): PlannedVariant[] {
  if (!presets.length) {
    const key = keyOfToggles(fallback);
    return key ? [{ key, toggles: fallback }] : [];
  }
  return presets.slice(0, max).map((p) => ({ key: p.id, toggles: p.toggles, name: p.name, ...(p.guide ? { guide: p.guide } : {}) }));
}

// ── 잡 파일 모양 (순수) ─────────────────────────────────────────────

export interface ComposeVariant {
  key: string;
  toggles: ComposeToggles;
  draft: string;
  sections: ComposeSection[];
  products: ProductRef[];
  ms: number;
  /** 이 벌을 쓴 Claude 세션 (고른 뒤 토글로 고쳐 쓸 때 이어 쓴다) */
  sessionId?: string;
}

export interface VariantsFile {
  version: number;
  replyId: string;
  rulebookSha: string;
  status: "running" | "done";
  startedAt: string;
  updatedAt: string;
  sessionId?: string;
  planned: PlannedVariant[];
  variants: ComposeVariant[];
  failed: { key: string; error: string }[];
}

export function newVariantsFile(replyId: string, rulebookSha: string, planned: readonly PlannedVariant[], now: string): VariantsFile {
  return {
    version: FILE_VERSION,
    replyId,
    rulebookSha,
    status: "running",
    startedAt: now,
    updatedAt: now,
    planned: [...planned],
    variants: [],
    failed: [],
  };
}

/** 아직 안 쓴 조합 열쇠 (쓴 것·실패한 것 제외) */
export function pendingKeys(file: VariantsFile): string[] {
  const done = new Set([...file.variants.map((v) => v.key), ...file.failed.map((f) => f.key)]);
  return file.planned.map((p) => p.key).filter((k) => !done.has(k));
}

/** 한 벌 결과를 넣는다 (같은 열쇠면 바꿔 끼움). 세션이 새로 생겼으면 이어 쓰게 남긴다. */
export function withVariant(file: VariantsFile, v: ComposeVariant, sessionId: string | undefined, now: string): VariantsFile {
  const variants = [...file.variants.filter((x) => x.key !== v.key), v];
  return { ...file, variants, updatedAt: now, ...(sessionId ? { sessionId } : {}) };
}

export function withFailure(file: VariantsFile, key: string, error: string, now: string): VariantsFile {
  return { ...file, failed: [...file.failed.filter((f) => f.key !== key), { key, error }], updatedAt: now };
}

/** 이 파일을 그대로 써도 되나 (파일 판과 규칙책이 같을 때만) */
export function isFresh(file: VariantsFile | null, sha: string): file is VariantsFile {
  return !!file && file.version === FILE_VERSION && file.rulebookSha === sha;
}

/** 멈춘 잡인가: running 인데 이 프로세스에서 안 돌고, heartbeat 가 오래됐다 (시작 직후 재개는 호출 쪽이 판단) */
export function isStale(file: VariantsFile, now: number, staleMs = STALE_MS): boolean {
  return file.status === "running" && now - Date.parse(file.updatedAt) > staleMs;
}

/** git hash-object 와 같은 값 (프로세스를 띄우지 않고 규칙책 판을 잰다) */
export function gitBlobSha(content: Buffer | string): string {
  const buf = typeof content === "string" ? Buffer.from(content) : content;
  return createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
}

// ── 파일 ────────────────────────────────────────────────────────────

function variantsDir(persona: PersonaConfig): string {
  return path.join(packPrivateDir(persona.id), "compose-variants");
}

function variantsPath(persona: PersonaConfig, replyId: string): string {
  const safe = replyId.replace(/[^A-Za-z0-9_.-]/g, "");
  if (!safe || safe.startsWith(".")) throw new Error(`잘못된 댓글 id: ${replyId}`);
  return path.join(variantsDir(persona), `${safe}.json`);
}

async function rulebookSha(persona: PersonaConfig): Promise<string> {
  try {
    return gitBlobSha(await readFile(packRulebookPath(persona.id)));
  } catch {
    return "none";
  }
}

export async function readVariantsFile(persona: PersonaConfig, replyId: string): Promise<VariantsFile | null> {
  try {
    return JSON.parse(await readFile(variantsPath(persona, replyId), "utf8")) as VariantsFile;
  } catch {
    return null;
  }
}

async function writeVariantsFile(persona: PersonaConfig, file: VariantsFile): Promise<void> {
  const out = variantsPath(persona, file.replyId);
  await mkdir(path.dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await rename(tmp, out);
}

/** 읽고-고치고-쓰기 (한 댓글 파일은 그 잡 하나만 쓰지만 heartbeat 와 겹치지 않게 한 줄로) */
function patchFile(persona: PersonaConfig, replyId: string, fn: (f: VariantsFile) => VariantsFile): Promise<VariantsFile | null> {
  const g = globalThis as typeof globalThis & { __variantsFileLocks?: Map<string, Promise<unknown>> };
  g.__variantsFileLocks ??= new Map();
  const key = `${persona.id}#${replyId}`;
  const run = (g.__variantsFileLocks.get(key) ?? Promise.resolve()).then(async () => {
    const cur = await readVariantsFile(persona, replyId);
    if (!cur) return null;
    const next = fn(cur);
    await writeVariantsFile(persona, next);
    return next;
  });
  g.__variantsFileLocks.set(key, run.catch(() => undefined));
  return run;
}

// ── 잡 실행 ─────────────────────────────────────────────────────────

interface QueueItem {
  persona: PersonaConfig;
  replyId: string;
}

interface QueueState {
  items: QueueItem[];
  running: Set<string>;
  working: boolean;
  /** 주인이 열어서 새치기한 댓글 (다시 세울 때도 맨 앞에 둔다) */
  pinned?: Set<string>;
}

function queue(): QueueState {
  const g = globalThis as typeof globalThis & { __composeVariantsQueue?: QueueState };
  g.__composeVariantsQueue ??= { items: [], running: new Set(), working: false };
  return g.__composeVariantsQueue;
}

const itemKey = (i: QueueItem) => `${i.persona.id}#${i.replyId}`;

/**
 * 이 버전 글을 댓글의 초안(answer)으로 삼을까 (10-02 비용 1): 답 초안 잡을 끈 계정은 버전 글이 첫 초안이다.
 * 첫 추천 버전이고, 아직 초안이 없는 대기 댓글일 때만 — 있던 초안·주인이 고른 버전은 덮지 않는다.
 */
export function adoptAsDraft(reply: ThreadsReply | undefined, firstKey: string, key: string): boolean {
  return !!reply && key === firstKey && isPending(reply) && !reply.answer?.draft;
}

/**
 * 동시에 미리 쓰는 댓글 수. 댓글 안의 추천 2벌도 동시에 쓰므로 CLI 수 = 이 값 × 2 (10-02: 기본 10 → CLI 20, 예전 "20개 한 번에"와 같은 부하).
 * 전역 캡(5)이 아니라 자기 칸(runInCliLane "variants-prefetch")에서 센다. claude -p 하나 ≈ 200MB.
 */
export function variantsParallel(raw = process.env.THREADS_VARIANTS_PARALLEL): number {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 10) : 10;
}

/** 첫 추천 버전 글을 초안으로 저장 (목록 '준비됨'·화면 기본 글). 조건은 adoptAsDraft */
async function adoptFirstVariant(replyId: string, firstKey: string, v: ComposeVariant): Promise<void> {
  const ledger = await readRepliesLedger();
  if (!adoptAsDraft(ledger.replies.find((r) => r.id === replyId), firstKey, v.key)) return;
  const set = parseToggles(v.toggles);
  if (typeof set === "string") return;
  await saveComposed(replyId, { draft: v.draft, sections: v.sections }, set, v.sessionId);
}

/** 한 벌 쓰기. 앞 벌을 보여주지 않고 새 세션으로 따로 쓴다 (앞 벌을 주면 그 글의 변형이 된다). */
async function writeOne(persona: PersonaConfig, file: VariantsFile, key: string): Promise<void> {
  const planned = file.planned.find((p) => p.key === key);
  if (!planned) return;
  const started = Date.now();
  const now = () => new Date().toISOString();
  try {
    const out = await draftFor(file.replyId, {
      fresh: true,
      toggles: planned.toggles,
      ...(planned.name ? { version: { name: planned.name, ...(planned.guide ? { guide: planned.guide } : {}) } } : {}),
    });
    if ("error" in out) {
      await patchFile(persona, file.replyId, (f) => withFailure(f, key, out.error, now()));
      return;
    }
    const v: ComposeVariant = { key, toggles: planned.toggles, draft: out.composed.draft, sections: out.composed.sections, products: out.products, ms: Date.now() - started, ...(out.sessionId ? { sessionId: out.sessionId } : {}) };
    await patchFile(persona, file.replyId, (f) => withVariant(f, v, out.sessionId, now()));
    await adoptFirstVariant(file.replyId, file.planned[0]?.key ?? "", v).catch(() => {});
  } catch (e) {
    await patchFile(persona, file.replyId, (f) => withFailure(f, key, e instanceof Error ? e.message : String(e), now()));
  }
}

/** 파일을 준비한다: 규칙책이 같고 끝났으면 null(할 일 없음), 아니면 이어 쓸(또는 새로 만든) 파일. */
async function prepare(persona: PersonaConfig, replyId: string): Promise<VariantsFile | null> {
  const sha = await rulebookSha(persona);
  const cur = await readVariantsFile(persona, replyId);
  if (isFresh(cur, sha)) return cur.status === "done" ? null : cur;
  const suggestion = await suggestForReply(replyId);
  if ("error" in suggestion) return null;
  const planned = planFromPresets(suggestion.presets, suggestion.toggles, PREFETCH_VARIANTS);
  if (!planned.length) return null;
  const file = newVariantsFile(replyId, sha, planned, new Date().toISOString());
  await writeVariantsFile(persona, file);
  return file;
}

async function runReply(persona: PersonaConfig, replyId: string): Promise<void> {
  const file = await prepare(persona, replyId);
  if (!file) return;
  const heartbeat = setInterval(() => void patchFile(persona, replyId, (f) => ({ ...f, updatedAt: new Date().toISOString() })).catch(() => {}), HEARTBEAT_MS);
  try {
    const cur = await readVariantsFile(persona, replyId);
    if (!cur || cur.rulebookSha !== file.rulebookSha) return;
    // 추천 1번 먼저, 그다음 2번 (10-02): 20개 댓글이 한꺼번에 돌 때 CLI 수 = 댓글 수, 첫 답이 모두 빨리 나온다
    const { write, dropped } = jobKeys(cur);
    if (dropped.length) console.warn(`[compose-variants] ${replyId}: 상한 ${MAX_WRITES_PER_JOB}벌을 넘는 계획 ${dropped.length}개를 쓰지 않음 (${dropped.join(", ")})`);
    // 추천 벌을 동시에 쓴다 (10-02 henry "버튼도 동시에") — 호출 수는 같고 기다림만 줄어든다. 시간 상한은 draftFor 의 한 벌 타임아웃이 지킨다
    await Promise.all(write.map((key) => writeOne(persona, cur, key)));
    await patchFile(persona, replyId, (f) => {
      const trimmed = { ...f, planned: f.planned.filter((p) => !dropped.includes(p.key)) };
      const left = pendingKeys(trimmed);
      const failed = left.reduce((acc, k) => withFailure(acc, k, "잡 시간 초과", new Date().toISOString()), trimmed);
      return { ...failed, status: "done", updatedAt: new Date().toISOString() };
    });
  } finally {
    clearInterval(heartbeat);
  }
}

/** 줄 선 댓글을 일꾼 여럿(variantsParallel)이 하나씩 가져가 처리한다. 절대 reject 하지 않는다. */
async function work(): Promise<void> {
  const q = queue();
  if (q.working) return;
  q.working = true;
  try {
    const n = variantsParallel();
    await runInCliLane("variants-prefetch", n, () => Promise.all(Array.from({ length: n }, () => workerLoop(q))));
  } finally {
    q.working = false;
  }
}

async function workerLoop(q: QueueState): Promise<void> {
  for (let item = q.items.shift(); item; item = q.items.shift()) {
    const current = item;
    q.running.add(itemKey(current));
    q.pinned?.delete(itemKey(current));
    try {
      await runWithPersonaConfig(current.persona, () => runReply(current.persona, current.replyId));
    } catch (e) {
      console.warn(`[compose-variants] ${current.replyId} 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      q.running.delete(itemKey(current));
    }
  }
}

/** 줄에 세운다. front 면 맨 앞(주인이 지금 연 댓글). 이미 줄에 있으면 front 일 때만 앞으로 옮긴다. */
function enqueue(item: QueueItem, front = false): boolean {
  const q = queue();
  const key = itemKey(item);
  if (q.running.has(key)) return false;
  const at = q.items.findIndex((i) => itemKey(i) === key);
  if (at >= 0) {
    if (front) {
      q.items.unshift(...q.items.splice(at, 1));
      (q.pinned ??= new Set()).add(key);
    }
    return false;
  }
  if (front) q.items.unshift(item);
  else q.items.push(item);
  if (front) (q.pinned ??= new Set()).add(key);
  return true;
}

/** 줄 선 댓글을 order 순서로 다시 세운다 (order 에 없는 것은 뒤에 그대로). 새 댓글이 옛 댓글 뒤에 밀리지 않게. */
export function reorderQueue<T>(items: readonly T[], keyOf: (t: T) => string, order: readonly string[]): T[] {
  const rank = new Map(order.map((k, i) => [k, i]));
  const at = (t: T) => rank.get(keyOf(t)) ?? Number.MAX_SAFE_INTEGER;
  return items.map((t, i) => ({ t, i })).sort((a, b) => at(a.t) - at(b.t) || a.i - b.i).map((x) => x.t);
}

/** 지금 계정의 미리 쓰기 줄: 쓰는 중(running)·차례 기다림(queued) 댓글 id. 목록 표시용 (10-02 — 답 초안 잡을 끈 뒤 진행 표시의 기준) */
export function variantsQueueState(personaId: string): { running: string[]; queued: string[] } {
  const q = queue();
  const mine = (key: string) => key.startsWith(`${personaId}#`);
  const idOf = (key: string) => key.slice(personaId.length + 1);
  return {
    running: [...q.running].filter(mine).map(idOf),
    queued: q.items.map(itemKey).filter(mine).map(idOf),
  };
}

/** 이미 도는 중이거나 줄 서 있나 */
export function isQueued(personaId: string, replyId: string): boolean {
  const q = queue();
  const key = `${personaId}#${replyId}`;
  return q.running.has(key) || q.items.some((i) => itemKey(i) === key);
}

/**
 * 댓글들의 미리 쓰기를 줄 세운다 (fire-and-forget, 멱등). 지금 페르소나 기준.
 * 끝났고 규칙책이 같은 댓글은 건너뛴다. running 인데 이 프로세스에서 안 도는 잡(고아)은 다시 줄 세운다.
 * 돌려주는 값 = 새로 줄 선 댓글 id.
 */
async function ensureVariants(replyIds: readonly string[], opts: { front?: boolean } = {}): Promise<string[]> {
  const persona = currentPersona();
  const sha = await rulebookSha(persona);
  const added: string[] = [];
  for (const replyId of opts.front ? [...replyIds].reverse() : replyIds) {
    const cur = await readVariantsFile(persona, replyId);
    if (isFresh(cur, sha) && cur.status === "done") continue;
    if (enqueue({ persona, replyId }, opts.front)) added.push(replyId);
  }
  void work();
  return added;
}

/** 목록 GET 이 미리 쓰는 댓글 수 (env 가 양의 정수가 아니면 기본값) */
export function prefetchLimit(raw = process.env.THREADS_VARIANTS_PREFETCH): number {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? Math.floor(n) : PREFETCH_COMMENTS;
}

/**
 * 답할 차례 댓글 가운데 앞순서 limit 개를 미리 쓴다. 목록 GET 에서 부른다.
 * 줄에 이미 선 댓글도 이번 순서로 다시 세운다 (새로 들어온 댓글이 앞으로 온다).
 */
export async function ensureVariantsForPending(limit = prefetchLimit()): Promise<string[]> {
  const ledger = await readRepliesLedger();
  const persona = currentPersona();
  const top = pendingOrder(ledger.replies).slice(0, limit);
  const { queued: added } = await requestVersions(top.map((r) => r.id), "prefetch");
  const q = queue();
  q.items = reorderQueue(q.items, itemKey, [...(q.pinned ?? []), ...top.map((r) => `${persona.id}#${r.id}`)]);
  return added;
}

/** 질문 먼저, 그 안에서 최신순. 반응(이모지·짧은 감탄)은 맨 뒤 — 버전이 필요 없는 경우가 많다. */
export function pendingOrder(replies: readonly ThreadsReply[]): ThreadsReply[] {
  const rank = (r: ThreadsReply) => (r.intent === "question" ? 0 : r.intent === "reaction" ? 2 : 1);
  return replies.filter(isPending).sort((a, b) => rank(a) - rank(b) || Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

/** 미리 쓰기 진행률: 지금 규칙책으로 끝난 댓글 수 / 대기 댓글 수 */
export function prefetchProgress(files: readonly (VariantsFile | null)[], sha: string): { done: number; total: number } {
  return { done: files.filter((f) => isFresh(f, sha) && f.status === "done").length, total: files.length };
}

/** 지금 페르소나의 대기 댓글 미리 쓰기 진행률 (목록 GET 이 화면에 싣는다) */
export async function pendingPrefetchProgress(): Promise<{ done: number; total: number }> {
  const persona = currentPersona();
  const ids = pendingOrder((await readRepliesLedger()).replies).map((r) => r.id);
  const files = await Promise.all(ids.map((id) => readVariantsFile(persona, id)));
  return prefetchProgress(files, await rulebookSha(persona));
}

// ── 화면용 읽기·고르기 ──────────────────────────────────────────────

export interface VariantsView {
  variants: ComposeVariant[];
  pending: string[];
  failed: { key: string; error: string }[];
  status: "running" | "done" | "queued" | "none";
}

/** 지금 페르소나의 미리 쓴 벌. 없거나 옛 규칙책이면 줄 세우고(kick=true) 빈 목록. */
export async function variantsFor(replyId: string, kick = true): Promise<VariantsView> {
  const persona = currentPersona();
  const cur = await readVariantsFile(persona, replyId);
  const fresh = isFresh(cur, await rulebookSha(persona));
  if (kick && (!fresh || cur.status !== "done")) await requestVersions([replyId], "prefetch", { front: true });
  if (!fresh) return { variants: [], pending: [], failed: [], status: isQueued(persona.id, replyId) ? "queued" : "none" };
  return { variants: cur.variants, pending: pendingKeys(cur), failed: cur.failed, status: cur.status };
}

export type ChooseResult = { variant: ComposeVariant; answer: unknown } | { error: string; status: number };

/** 누를 때 쓴 벌을 버전 파일에 더한다 (파일이 없으면 끝난 파일을 새로 만든다). 순수. */
export function rememberIn(file: VariantsFile | null, replyId: string, sha: string, v: ComposeVariant, now: string): VariantsFile {
  const base = file ?? { ...newVariantsFile(replyId, sha, [], now), status: "done" as const };
  return withVariant(base, v, v.sessionId, now);
}

/**
 * 누를 때 쓴 버전(POST compose · preset)도 미리 쓴 벌처럼 남긴다 (2026-10-02 henry "한번 생성한 결과물은 화면을 나가도 남아야").
 * 안 남기면 다른 버전을 봤다가 돌아올 때 같은 버전을 처음부터 다시 쓴다. 실패해도 답 자체는 이미 저장돼 있다.
 */
export async function rememberVariant(replyId: string, v: ComposeVariant): Promise<void> {
  const persona = currentPersona();
  const sha = await rulebookSha(persona);
  const cur = await readVariantsFile(persona, replyId);
  if (cur && !isFresh(cur, sha)) return; // 규칙책이 바뀐 옛 파일은 미리 쓰기가 갈아엎는다
  if (cur) await patchFile(persona, replyId, (f) => rememberIn(f, replyId, sha, v, new Date().toISOString()));
  else await writeVariantsFile(persona, rememberIn(null, replyId, sha, v, new Date().toISOString()));
}

/** 미리 쓴 벌 하나를 고른 초안으로 저장 (draft = aiDraft = 그 글). */
export async function chooseVariant(replyId: string, key: string): Promise<ChooseResult> {
  const persona = currentPersona();
  const cur = await readVariantsFile(persona, replyId);
  const variant = cur?.variants.find((v) => v.key === key);
  if (!cur || !variant) return { error: "그 조합은 아직 안 써졌어요", status: 404 };
  const set = parseToggles(variant.toggles);
  if (typeof set === "string") return { error: set, status: 400 };
  const answer = await saveComposed(replyId, { draft: variant.draft, sections: variant.sections }, set, variant.sessionId ?? cur.sessionId);
  if (!answer) return { error: "해당 댓글이 원장에 없습니다", status: 404 };
  return { variant, answer };
}

// ── 고아 스윕 (서버 시작·1분마다) ───────────────────────────────────

async function staleIn(persona: PersonaConfig, now: number): Promise<string[]> {
  let names: string[] = [];
  try {
    names = await readdir(variantsDir(persona));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const file = await readVariantsFile(persona, name.slice(0, -5));
    if (file && isStale(file, now) && !isQueued(persona.id, file.replyId)) out.push(file.replyId);
  }
  return out;
}

/** instrumentation.ts 에서 한 번 부른다. 멈춘 미리 쓰기 잡을 다시 줄 세운다. */
export function registerComposeVariantsSweep(): void {
  registerSweepAdapter({
    name: "threads-compose-variants",
    sweep: async () => {
      for (const id of await listPersonaIds()) {
        const persona = await readPersona(id);
        const stale = await staleIn(persona, Date.now());
        if (stale.length) await runWithPersonaConfig(persona, () => requestVersions(stale, "resume"));
      }
    },
  });
}
