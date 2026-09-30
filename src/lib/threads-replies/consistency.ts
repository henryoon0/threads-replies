// 예전 답과 어긋남 찾기 (09-29 henry: "이전에 대답했던 내용과 다르게 제안하면 안 된다.
// 그런 경우가 있으면 글에 색을 칠해서 너 예전에 이렇게 대답했어 알려주는 건 좋다").
//
// 초안 문장 × 주인의 예전 답(pastSaid)을 fast 티어 한 번으로 대조해, 같은 점에 대해 다른 말을 하는
// 문장만 돌려받는다. 모델은 예전 답에서 그대로 옮긴 구절을 함께 내야 하고, 코드가 그 구절이
// 예전 답 원문에 정말 있는지 확인한다 — 없는 예전 답을 지어내면 버린다. 글은 절대 고치지 않는다.
// 순수 부분(문장 위치·정리·원문 확인·칠하기 합치기)은 consistency-spans.ts, 여기는 호출·캐시.

import { createHash } from "node:crypto";
import { generateText } from "@/lib/ai/generate";
import { tryParseModelJson } from "@/lib/ai/json";
import { buildConsistencyPrompt, normalizeConflicts, type DraftForCheck } from "./consistency-spans";
import type { ConsistencyHit, PastSaid, ReplyAnswer } from "./model";
import { envMs } from "./storage";

// ── 호출 · 캐시 ───────────────────────────────────────────

export function consistencyTimeoutMs(): number {
  return envMs("THREADS_CONSISTENCY_TIMEOUT_MS", 90_000);
}

const CACHE_MAX = 300;
function cache(): Map<string, Promise<Record<string, ConsistencyHit[]>>> {
  const g = globalThis as typeof globalThis & { __threadsConsistency?: Map<string, Promise<Record<string, ConsistencyHit[]>>> };
  g.__threadsConsistency ??= new Map();
  return g.__threadsConsistency;
}

function cacheKey(ownerName: string, drafts: readonly DraftForCheck[], past: readonly PastSaid[]): string {
  const h = createHash("sha1");
  h.update(ownerName);
  for (const d of drafts) h.update(`\u0000${d.key}\u0000${d.text}`);
  for (const p of past) h.update(`\u0001${p.id}`);
  return h.digest("hex");
}

export type ConsistencyRun = (prompt: string) => Promise<string>;

function defaultRun(prompt: string): Promise<string> {
  const timeoutMs = consistencyTimeoutMs();
  return generateText({ tier: "fast", json: true, prompt, timeoutMs, deadlineMs: Date.now() + timeoutMs + 15_000 });
}

/**
 * 벌마다 예전 답과 어긋나는 문장. 예전 답이 없거나 글이 비면 부르지 않는다.
 * 같은 글·같은 예전 답이면 캐시를 쓴다 (실패는 캐시하지 않고 그대로 던진다).
 */
export function findConflicts(
  ownerName: string,
  drafts: readonly DraftForCheck[],
  past: readonly PastSaid[],
  run: ConsistencyRun = defaultRun
): Promise<Record<string, ConsistencyHit[]>> {
  const live = drafts.filter((d) => d.text.trim());
  const empty = Object.fromEntries(drafts.map((d) => [d.key, [] as ConsistencyHit[]]));
  if (!past.length || !live.length) return Promise.resolve(empty);
  const key = cacheKey(ownerName, live, past);
  const known = cache().get(key);
  if (known) return known;
  const job = run(buildConsistencyPrompt(ownerName, live, past)).then((text) => ({ ...empty, ...normalizeConflicts(tryParseModelJson(text), live, past) }));
  cache().set(key, job);
  job.catch(() => cache().delete(key));
  if (cache().size > CACHE_MAX) cache().delete(cache().keys().next().value as string);
  return job;
}

/** 옵션 표시 A, B, C … */
export function optionKey(i: number): string {
  return String.fromCharCode(65 + i);
}

/**
 * 초안 전체(모든 벌)를 예전 답과 한 번에 대조해 벌마다 consistency 를 붙인다.
 * 실패해도 초안은 그대로 돌려준다 (칠하기가 없을 뿐).
 */
function draftsOf(answer: ReplyAnswer): DraftForCheck[] {
  const options = answer.options ?? [];
  return options.length ? options.map((o, i) => ({ key: optionKey(i), text: o.draft })) : [{ key: optionKey(0), text: answer.draft }];
}

/** 벌마다 결과를 붙이고, 고른 벌이 지금 글이면 그 결과를 완성된 답에도 둔다. */
function attach(answer: ReplyAnswer, found: Record<string, ConsistencyHit[]>): ReplyAnswer {
  const options = answer.options ?? [];
  if (!options.length) return { ...answer, consistency: found[optionKey(0)] ?? [], consistencyFor: answer.draft };
  const nextOptions = options.map((o, i) => ({ ...o, consistency: found[optionKey(i)] ?? [] }));
  const chosen = nextOptions[answer.chosen ?? 0];
  const forDraft = chosen?.draft === answer.draft ? chosen.consistency : [];
  return { ...answer, options: nextOptions, consistency: forDraft, consistencyFor: answer.draft };
}

/**
 * 초안 전체(모든 벌)를 예전 답과 한 번에 대조해 벌마다 consistency 를 붙인다.
 * 실패해도 초안은 그대로 돌려준다 (칠하기가 없을 뿐).
 */
export async function withConsistency(answer: ReplyAnswer, ownerName: string, run?: ConsistencyRun): Promise<ReplyAnswer> {
  if (!answer.pastSaid?.length) return answer;
  try {
    return attach(answer, await findConflicts(ownerName, draftsOf(answer), answer.pastSaid, run));
  } catch (error) {
    console.warn("[consistency] 예전 답 대조 실패:", error instanceof Error ? error.message : error);
    return answer;
  }
}

/** 완성된 답 하나만 대조 (주인이 고치는 동안 · POST /api/threads-replies/[id]/consistency) */
export async function checkFinal(text: string, past: readonly PastSaid[], ownerName: string, run?: ConsistencyRun): Promise<ConsistencyHit[]> {
  const found = await findConflicts(ownerName, [{ key: FINAL_KEY, text }], past, run);
  return found[FINAL_KEY] ?? [];
}

const FINAL_KEY = "Z";
