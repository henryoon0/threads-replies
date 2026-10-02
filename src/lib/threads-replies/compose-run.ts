// 토글 초안 실행 — 원장·팩 세션·모델 호출 (순수 조립은 compose.ts, 요청문은 compose-prompts.ts).
//
//   POST /api/threads-replies/[id]/compose  → composeReply(id, { toggles, base })
//   GET  같은 경로                          → suggestForReply(id)  (비슷한 댓글에 주인이 넣은 조각)
//   composeBatch(ids)                       → 댓글 5개까지 차례로 (토글 없으면 제안값으로)
//
// 세션: 이 댓글의 Claude 세션(answer.sessionId)에 이어 쓴다. 토글을 끄면 앞 초안을 base 로 주고 그 조각만 빼게 한다.
// 이어 쓰기가 실패하면 새 세션으로 처음부터(맥락 전부 싣고). 조각을 빼기만 하는데 모델이 실패하면 코드가 뺀다.
import { isStaleJobDraft } from "./usable-draft";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runClaudeCLI } from "@/lib/ai/claude-cli";
import { parseJsonObject } from "@/lib/ai/json";
import { parseCategoriesFile, readCategories } from "@/lib/personas/categories";
import { currentPersona } from "@/lib/personas/context";
import type { PersonaConfig } from "@/lib/personas/model";
import { productsForPrompt, productsInDraft, readProducts, toRef, type Product, type ProductRef } from "@/lib/personas/products";
import { packDir, packPrivateDir } from "@/lib/personas/registry";
import {
  assembleSections,
  attachAsk,
  readAskBack,
  isRemovalOnly,
  parseToggles,
  previousComposed,
  readSections,
  removeSections,
  toToggles,
  withComposed,
  type ComposedAnswer,
  type ComposedDraft,
  type ComposeSection,
  type ComposeToggles,
  type RawSection,
  type ToggleSet,
} from "./compose";
import { stripMarkers, suggestToggles, voiceViolations, type ComposeKind, type LabeledComment, type PairLabel } from "./compose-kinds";
import { derivePresets, presetSet, presetsFromCategories, rankByNeighbors, rankByOrder, type RankedPreset } from "./compose-presets";
import { buildComposePrompt, buildVoiceFixPrompt, type KindSegment } from "./compose-prompts";
import { ANSWER_EFFORT, ANSWER_MODEL, canRetryFresh, detailedCategories, ownerLine, packWorkspaceDir, pastSaidBlock, readSafety, systemAppendFor } from "./draft";
import type { ThreadsRepliesLedger, ThreadsReply } from "./model";
import { withTimeout } from "./more-options";
import { envMs, keyedLock, ledgerPath, readRepliesLedger, updateRepliesLedger } from "./storage";
import { conversationFor } from "./summary";
import { parseExampleBank, pickAsks, pickExamples, type BankEntry } from "./example-bank";
import { loadVoiceExamples } from "./voice";
import { isLightNeed, readingBlock, type ReadingExample } from "./reading";
import { readComment } from "./reading-run";

const DEFAULT_COMPOSE_TIMEOUT_MS = 4 * 60 * 1000;
const CALL_TIMEOUT_MS = 180_000;
export const BATCH_MAX = 5;

export interface ComposeBody {
  toggles?: unknown;
  /** 앞 초안 글. 미리 쓰기(compose-variants)는 { draft, kinds } 로 넘겨 조각 종류까지 알려준다. */
  base?: unknown;
  /** 이어 쓸 세션 (미리 쓰기가 댓글마다 한 세션을 들고 다닌다). 없으면 원장 답의 세션. */
  sessionId?: string;
  /** 버전 id (compose-presets). 버전 이름·지시를 요청문에 싣는다. */
  preset?: string;
  /** 버전 이름·지시 (미리 쓰기는 파일에 적어 둔 것을 바로 넘긴다) */
  version?: { name: string; guide?: string };
  /**
   * 원장의 옛 세션·옛 초안을 이어받지 않는다 (미리 쓰기). 이어 쓸 세션과 앞 초안은 body 로 준 것만 쓴다.
   * 2026-09-30: 미리 쓰기가 읽기 단계 전 세션(옛 안전 규칙으로 "의사쌤한테 물어봐"를 쓴 기록)에 이어 쓰고,
   * 원장의 옛 초안을 앞 초안으로 받아 "남는 글자는 그대로 둔다"로 떠넘기기를 6벌에 옮겼다.
   */
  fresh?: boolean;
}

export type ComposeResult =
  | { draft: string; sections: ComposeSection[]; sessionId?: string; toggles: ComposeToggles; products: ProductRef[]; answer: ComposedAnswer }
  | { error: string; status: number };

// ── 팩 재료 (I/O) ───────────────────────────────────────────────────

interface LabelsFile {
  labels: Record<string, PairLabel & { comment: string }>;
}

export async function readLabels(persona: PersonaConfig): Promise<LabeledComment[]> {
  try {
    const raw = JSON.parse(await readFile(path.join(packPrivateDir(persona.id), "voice-labels.json"), "utf8")) as LabelsFile;
    return Object.values(raw.labels ?? {}).map((l) => ({ comment: l.comment, label: l }));
  } catch {
    return [];
  }
}

/**
 * 켠 종류별 레퍼런스 조각. 팩에 예시 은행(examples.md)이 있으면 댓글마다 다른 부분집합을 고르고,
 * 없으면 categories.json 의 고정 조각. 이번 댓글과 같은 댓글에서 온 조각과 exclude 쌍은 뺀다(자기 답 베끼기 방지).
 */
export async function segmentsFor(
  dir: string,
  commentText: string,
  set: ToggleSet,
  labels: readonly LabeledComment[],
  exclude: ReadonlySet<string> = new Set()
): Promise<Partial<Record<ComposeKind, KindSegment[]>>> {
  const own = new Set(labels.filter((l) => l.comment.trim() === commentText.trim()).flatMap((l) => l.label.segments.map((s) => s.text)));
  const bank = await readBank(dir);
  if (bank.length) {
    return pickExamples(bank.filter((e) => !own.has(e.text)), { comment: commentText, kinds: set.kinds, channels: set.channels, exclude });
  }
  const file = await readCategoriesAt(dir);
  const out: Partial<Record<ComposeKind, KindSegment[]>> = {};
  for (const c of file?.categories ?? []) {
    const segs = ((c as { segments?: KindSegment[] }).segments ?? []).filter((s) => !own.has(s.text) && !exclude.has(s.pairId));
    out[c.id as ComposeKind] = segs;
  }
  return out;
}

/** 주인이 실제로 되물은 문장 몇 개 (예시 은행이 없으면 없음) */
export async function asksFor(dir: string, commentText: string, exclude: ReadonlySet<string> = new Set()): Promise<string[]> {
  return pickAsks(await readBank(dir), { comment: commentText, exclude });
}

async function readBank(dir: string): Promise<BankEntry[]> {
  try {
    return parseExampleBank(await readFile(path.join(dir, "examples.md"), "utf8"));
  } catch {
    return [];
  }
}

async function readCategoriesAt(dir: string) {
  try {
    return parseCategoriesFile(JSON.parse(await readFile(path.join(dir, "categories.json"), "utf8")));
  } catch {
    return null;
  }
}

// ── 맥락 ────────────────────────────────────────────────────────────

function clip(text: string, max: number): string {
  const t = (text ?? "").trim();
  return t.length > max ? `${t.slice(0, max)}(생략)` : t;
}

function contextOf(ledger: ThreadsRepliesLedger, reply: ThreadsReply, owner: string, answer?: ComposedAnswer): string {
  const post = ledger.posts.find((p) => p.id === reply.postId)?.text ?? "";
  const conv = conversationFor(ledger, reply) ?? [];
  const convBlock = conv.length ? `\n<conversation_so_far>\n${conv.map((m) => `${m.username}: ${clip(m.text, 400)}`).join("\n")}\n</conversation_so_far>` : "";
  const prev = reply.repliedToText && reply.repliedToId !== reply.postId ? `\n<owner_previous_reply>${clip(reply.repliedToText, 400)}</owner_previous_reply>` : "";
  return `<my_post>\n${clip(post, 1200)}\n</my_post>${convBlock}${prev}\n<comment author="${reply.username}">\n${reply.text.trim()}\n</comment>\n${pastSaidBlock(answer?.pastSaid, owner)}`;
}

// ── 모델 호출 ───────────────────────────────────────────────────────

export interface CallEnv {
  persona: PersonaConfig;
  workspaceDir: string | null;
  systemAppend: string;
  signal: AbortSignal;
}

function call(env: CallEnv, prompt: string, sessionId: string, resume: boolean): Promise<string> {
  return runClaudeCLI(prompt, {
    model: ANSWER_MODEL,
    effort: ANSWER_EFFORT,
    timeoutMs: envMs("THREADS_COMPOSE_CALL_TIMEOUT_MS", CALL_TIMEOUT_MS),
    requireClaude: true,
    noTools: true,
    systemAppend: env.systemAppend,
    signal: env.signal,
    ...(env.workspaceDir ? { workspace: { dir: env.workspaceDir, sessionId, ...(resume ? { resume } : {}) } } : {}),
  });
}

export interface Plan {
  set: ToggleSet;
  context: string;
  segments: Partial<Record<ComposeKind, KindSegment[]>>;
  asks?: string[];
  base?: { draft: string; kinds?: ComposeKind[] };
  prev: { composed: ComposedDraft; kinds: ComposeKind[] } | null;
  resumeId?: string;
  products: Product[];
  version?: { name: string; guide?: string };
  /** 읽기 단계 결과 (조립한 글) · 그때 실은 과거 읽기 예시 */
  reading?: string;
  readingExamples?: ReadingExample[];
  /** 가벼운 말 걸기로 읽혔다: 켠 조각이 빠져도 된다 */
  light?: boolean;
}

function promptOf(env: CallEnv, plan: Plan, resumed: boolean): string {
  return buildComposePrompt({
    owner: env.persona.ownerName,
    ownerLine: ownerLine(env.persona),
    context: plan.context,
    kinds: plan.set.kinds,
    channels: plan.set.channels,
    segments: plan.segments,
    base: plan.base,
    resumed,
    products: plan.products,
    version: plan.version,
    asks: plan.asks,
    reading: plan.reading,
    readingExamples: plan.readingExamples,
  });
}

/** 이어 쓰기 → 실패하면 새 세션으로 처음부터 */
async function firstCall(env: CallEnv, plan: Plan): Promise<{ text: string; sessionId: string }> {
  if (plan.resumeId && env.workspaceDir) {
    try {
      return { text: await call(env, promptOf(env, plan, true), plan.resumeId, true), sessionId: plan.resumeId };
    } catch (e) {
      if (!canRetryFresh(e)) throw e;
    }
  }
  const sessionId = randomUUID();
  return { text: await call(env, promptOf(env, plan, false), sessionId, false), sessionId };
}

/** 달래기 문형이 남았으면 같은 세션에서 한 번 고친다. 기호는 이미 코드가 지웠다. */
async function fixVoice(env: CallEnv, plan: Plan, sections: RawSection[], sessionId: string): Promise<RawSection[]> {
  const phrases = sections.flatMap((s) => voiceViolations(s.text).map((v) => v.phrase));
  if (!phrases.length || !env.workspaceDir) return sections;
  try {
    const text = await call(env, buildVoiceFixPrompt(env.persona.ownerName, phrases), sessionId, true);
    const next = readSections(parseJsonObject(text), plan.set.kinds);
    return next.missing.length ? sections : next.sections;
  } catch (e) {
    if (!canRetryFresh(e)) throw e;
    return sections;
  }
}

export async function composeText(env: CallEnv, plan: Plan): Promise<{ composed: ComposedDraft; sessionId?: string }> {
  const { text, sessionId } = await firstCall(env, plan);
  const raw = parseJsonObject(text);
  const read = readSections(raw, plan.set.kinds);
  const ask = readAskBack(raw);
  if (read.missing.length && ask.enough && !(plan.light && read.sections.length)) {
    const fallback = plan.prev && isRemovalOnly(plan.prev.kinds, plan.set.kinds) ? removeSections(plan.prev.composed, plan.set.kinds) : null;
    if (fallback) return { composed: fallback, sessionId };
    throw new Error(`초안에 켠 조각이 빠졌어요: ${read.missing.join(", ")}`);
  }
  const fixed = await fixVoice(env, plan, read.sections, sessionId);
  const clean = attachAsk(fixed, ask.ask, plan.set.kinds).map((s) => ({ ...s, text: stripMarkers(s.text) }));
  return { composed: assembleSections(clean), sessionId: env.workspaceDir ? sessionId : undefined };
}

// ── 한 댓글 ─────────────────────────────────────────────────────────

function baseOf(body: ComposeBody, prev: Plan["prev"]): Plan["base"] {
  const given = body.base as { draft?: unknown; kinds?: unknown } | null | undefined;
  if (given && typeof given === "object" && typeof given.draft === "string" && Array.isArray(given.kinds)) {
    return { draft: given.draft, kinds: given.kinds as ComposeKind[] };
  }
  const text = typeof body.base === "string" ? body.base.trim() : "";
  if (!text) return prev ? { draft: prev.composed.draft, kinds: prev.kinds } : undefined;
  return prev && prev.composed.draft.trim() === text ? { draft: text, kinds: prev.kinds } : { draft: text };
}

/** 댓글 읽기 (댓글당 한 번, 캐시). 실패하면 읽기 없이 쓴다. */
async function readingFor(ledger: ThreadsRepliesLedger, reply: ThreadsReply, persona: PersonaConfig, safety: string, set: ToggleSet): Promise<Pick<Plan, "reading" | "readingExamples" | "light">> {
  const post = ledger.posts.find((p) => p.id === reply.postId)?.text ?? "";
  const conv = (conversationFor(ledger, reply) ?? []).map((m) => `${m.username}: ${clip(m.text, 400)}`).join("\n");
  const out = await readComment(persona, packDir(persona.id), packPrivateDir(persona.id), {
    post,
    comment: reply.text,
    commenter: reply.username,
    ...(conv ? { conversation: conv } : {}),
    safety,
    ownerLine: ownerLine(persona),
  });
  return out ? { reading: readingBlock(persona.ownerName, out.reading, { humor: set.kinds.includes("joke") }), readingExamples: out.examples, light: isLightNeed(out.reading.need) } : {};
}

/** 이어 쓸 세션과 앞 초안. fresh 면 body 로 준 것만 (원장의 옛 세션·옛 초안을 이어받지 않는다). */
function carryOver(body: ComposeBody, prev: Plan["prev"], answer: ComposedAnswer | undefined): Pick<Plan, "base" | "resumeId"> {
  if (body.fresh) return { base: baseOf(body, null), resumeId: body.sessionId };
  return { base: baseOf(body, prev), resumeId: body.sessionId ?? answer?.sessionId };
}

async function planFor(ledger: ThreadsRepliesLedger, reply: ThreadsReply, set: ToggleSet, body: ComposeBody, persona: PersonaConfig, safety: string): Promise<Plan> {
  const answer = reply.answer as ComposedAnswer | undefined;
  const labels = await readLabels(persona);
  const prev = previousComposed(answer);
  const post = ledger.posts.find((p) => p.id === reply.postId)?.text ?? "";
  const products = set.kinds.includes("product") ? productsForPrompt(await readProducts(persona.id), set.channels, `${reply.text}\n${post}`) : [];
  const version = body.version ?? (body.preset ? await versionOf(persona, reply, body.preset) : undefined);
  return {
    set,
    context: contextOf(ledger, reply, persona.ownerName, answer),
    segments: await segmentsFor(packDir(persona.id), reply.text, set, labels),
    asks: await asksFor(packDir(persona.id), reply.text),
    ...carryOver(body, prev, answer),
    prev,
    products,
    ...(version ? { version } : {}),
    ...(await readingFor(ledger, reply, persona, safety, set)),
  };
}

export async function saveComposed(replyId: string, composed: ComposedDraft, set: ToggleSet, sessionId?: string): Promise<ComposedAnswer | null> {
  const now = new Date().toISOString();
  let saved: ComposedAnswer | null = null;
  await updateRepliesLedger((l) => ({
    ...l,
    replies: l.replies.map((r) => {
      if (r.id !== replyId) return r;
      // 옛 3벌 잡 글(근거·판정·3벌)은 이어받지 않고 새로 시작한다 (10-02)
      saved = withComposed(isStaleJobDraft(r.answer) ? undefined : r.answer, composed, set, { model: ANSWER_MODEL, now, sessionId });
      return { ...r, answer: saved };
    }),
  }));
  return saved;
}

export type DraftResult =
  | { composed: ComposedDraft; sessionId?: string; set: ToggleSet; products: ProductRef[] }
  | { error: string; status: number };

/** 토글 초안 글만 쓴다 (원장에 저장하지 않음). 미리 쓰기와 composeOnce 가 같이 쓴다. */
export async function draftFor(replyId: string, body: ComposeBody): Promise<DraftResult> {
  const set = parseToggles(body.toggles);
  if (typeof set === "string") return { error: set, status: 400 };
  const ledger = await readRepliesLedger();
  const reply = ledger.replies.find((r) => r.id === replyId);
  if (!reply) return { error: "해당 댓글이 원장에 없습니다", status: 404 };
  const persona = currentPersona();
  const safety = await readSafety(persona);
  const [plan, workspaceDir] = await Promise.all([planFor(ledger, reply, set, body, persona, safety), packWorkspaceDir(persona)]);
  const { composed, sessionId } = await withTimeout(
    (signal) => composeText({ persona, workspaceDir, systemAppend: systemAppendFor(safety), signal }, plan),
    envMs("THREADS_COMPOSE_TIMEOUT_MS", DEFAULT_COMPOSE_TIMEOUT_MS),
    "토글 초안"
  );
  return { composed, sessionId, set, products: productsInDraft(composed.draft, plan.products).map(toRef) };
}

async function composeOnce(replyId: string, body: ComposeBody): Promise<ComposeResult> {
  const out = await draftFor(replyId, body);
  if ("error" in out) return out;
  const { composed, sessionId, set, products } = out;
  const answer = await saveComposed(replyId, composed, set, sessionId);
  if (!answer) return { error: "저장 중에 댓글이 사라졌어요", status: 409 };
  return { draft: composed.draft, sections: composed.sections, ...(sessionId ? { sessionId } : {}), toggles: toToggles(set), products, answer };
}

/** 토글 초안 하나. 같은 댓글 요청은 한 줄로 세운다 (같은 세션에 동시에 이어 쓰지 않게). */
export function composeReply(replyId: string, body: ComposeBody): Promise<ComposeResult> {
  return withReplyLock(replyId, () => composeOnce(replyId, body));
}

/** 같은 댓글의 세션을 쓰는 일(토글 초안·미리 쓰기)을 한 줄로 세운다. */
export function withReplyLock<T>(replyId: string, fn: () => Promise<T>): Promise<T> {
  const lock = keyedLock("compose", `${ledgerPath()}#${replyId}`);
  const run = lock.tail.then(fn);
  lock.tail = run.catch(() => undefined);
  return run;
}

// ── 버전 제안 ───────────────────────────────────────────────────────

export type SuggestedPreset = RankedPreset & { toggles: ComposeToggles };

export type SuggestResult = { toggles: ComposeToggles; neighbors: number; presets: SuggestedPreset[] } | { error: string; status: number };

/**
 * 이 계정의 버전과 이 댓글에 맞는 순서. 조각 태깅이 있으면 조각 조합 횟수로, 없으면 답 유형으로.
 * 버전 목록은 모든 댓글에 같다 (태깅 전체로 뽑는다). 순서만 댓글마다 다르다 (자기 답은 빼고 비교).
 */
async function presetsFor(persona: PersonaConfig, reply: ThreadsReply): Promise<{ presets: RankedPreset[]; neighbors: number }> {
  const labels = await readLabels(persona);
  if (labels.length) {
    const others = labels.filter((l) => l.comment.trim() !== reply.text.trim());
    return { presets: rankByNeighbors(reply.text, derivePresets(labels.map((l) => l.label)), others), neighbors: Math.min(7, others.length) };
  }
  const cats = (await readCategories(persona.id))?.categories ?? [];
  if (!cats.length) return { presets: [], neighbors: 0 };
  const order = detailedCategories(reply.text, cats, await loadVoiceExamples(persona), cats.length).map((d) => d.category.id);
  return { presets: rankByOrder(presetsFromCategories(cats), order), neighbors: 0 };
}

async function versionOf(persona: PersonaConfig, reply: ThreadsReply, id: string): Promise<{ name: string; guide?: string } | undefined> {
  const p = (await presetsFor(persona, reply)).presets.find((x) => x.id === id);
  return p ? { name: p.name, ...(p.guide ? { guide: p.guide } : {}) } : undefined;
}

export async function suggestForReply(replyId: string): Promise<SuggestResult> {
  const ledger = await readRepliesLedger();
  const reply = ledger.replies.find((r) => r.id === replyId);
  if (!reply) return { error: "해당 댓글이 원장에 없습니다", status: 404 };
  const persona = currentPersona();
  const { presets, neighbors } = await presetsFor(persona, reply);
  const withToggles = presets.map((p) => ({ ...p, toggles: toToggles(presetSet(p)) }));
  if (withToggles.length) return { toggles: withToggles[0].toggles, neighbors, presets: withToggles };
  const s = suggestToggles(reply.text, []);
  return { toggles: toToggles({ kinds: s.kinds, channels: s.channels }), neighbors: 0, presets: [] };
}

// ── 여러 댓글 ───────────────────────────────────────────────────────

export interface BatchItem {
  id: string;
  toggles?: unknown;
}

export type BatchResult = { id: string; result: ComposeResult };

/** 댓글 5개까지 차례로 토글 초안을 쓴다. 토글이 없으면 그 댓글의 제안값. 하나가 실패해도 나머지는 계속. */
export async function composeBatch(items: readonly BatchItem[]): Promise<BatchResult[]> {
  const out: BatchResult[] = [];
  for (const item of items.slice(0, BATCH_MAX)) {
    out.push({ id: item.id, result: await batchOne(item) });
  }
  return out;
}

async function batchOne(item: BatchItem): Promise<ComposeResult> {
  try {
    let toggles = item.toggles;
    if (!toggles) {
      const s = await suggestForReply(item.id);
      if ("error" in s) return s;
      toggles = s.toggles;
    }
    return await composeReply(item.id, { toggles });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), status: 500 };
  }
}
