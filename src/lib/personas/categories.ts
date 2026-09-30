// 답글 카테고리 (시안 픽 9 "초안 3벌", 2026-09-29).
//
// 주인이 실제로 단 답을 유형별로 나눈 목록이 팩의 categories.json 이다. 초안기는 댓글마다 이 가운데
// 맞는 셋을 골라, 카테고리마다 그 유형의 정교한 지시문(prompt)으로 한 벌씩 쓴다.
// 만드는 쪽: scripts/personas/build-categories.ts (실제 답 통계는 코드가 재고, 유형 나누기·지시문은
// Opus 가 쓰고, 비율·예시·검증은 다시 코드가 한다).
//
// 위쪽은 순수(통계·검증·비율), 아래 "파일" 절만 I/O 다.

import { readFile, stat } from "node:fs/promises";
import type { PersonaId } from "./model";
import { packFile } from "./registry";

export interface CategoryStats {
  count: number;
  lengthMedian: number;
  lengthP90: number;
  sentencesMedian: number;
  firstWords: { word: string; count: number }[];
  endings: { ending: string; pct: number }[];
  /** 버릇별 비율(%) — 이모지·느낌표·띄운 느낌표·ㅋㅋ/ㅎㅎ·..·~·끝 "-"·되묻기·줄바꿈·번호 목록 */
  habits: Record<string, number>;
}

export interface ReplyCategory {
  id: string;
  name: string;
  when: string;
  /** 실제 답 가운데 이 유형 비율 (%, 코드가 계산) */
  share: number;
  prompt: string;
  exampleIds: string[];
  stats: CategoryStats;
}

export interface CategoriesFile {
  version: 1;
  personaId: string;
  builtAt: string;
  model: string;
  source: { pairs: number; excluded: number; unassigned: number };
  categories: ReplyCategory[];
}

// ── 통계 (순수) ─────────────────────────────────────────────────────

const EMOJI = /\p{Extended_Pictographic}/u;

export function charLength(text: string): number {
  return [...text.trim()].length;
}

function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function countSentences(text: string): number {
  return text.split(/(?<=[.!?])\s+|\n+|\s{2,}/).filter((s) => s.trim()).length;
}

function firstWord(text: string): string {
  const w = text.trim().split(/\s+/)[0] ?? "";
  return w.replace(/[!?.,~…]+$/u, "").slice(0, 12);
}

const ENDING_RULES: [string, RegExp][] = [
  ["이모지", /\p{Extended_Pictographic}\s*$/u],
  ["느낌표 셋 이상", /!{3,}\s*$/],
  ["느낌표", /!\s*$/],
  ["말줄임 ..", /(\.\.|…)\s*$/],
  ["물음표", /\?\s*$/],
  ["ㅋㅋ", /ㅋ{2,}\s*$/],
  ["ㅎㅎ", /ㅎ{2,}\s*$/],
  ["물결 ~", /~+\s*$/],
  ["끝 -", /-\s*$/],
  ["마침표", /\.\s*$/],
  ["요", /요\s*$/],
];

export function endingOf(text: string): string {
  const t = text.trim();
  return ENDING_RULES.find(([, re]) => re.test(t))?.[0] ?? "기타";
}

const HABITS: [string, RegExp][] = [
  ["이모지", EMOJI],
  ["느낌표", /!/],
  ["띄운 느낌표", /\S\s+!/],
  ["ㅋㅋ·ㅎㅎ", /(ㅋㅋ|ㅎㅎ)/],
  ["말줄임", /(\.\.|…)/],
  ["물결", /~/],
  ["끝 -", /-(\s|$)/],
  ["되묻기", /\?/],
  ["줄바꿈", /\n/],
  ["번호 목록", /(^|\s)(\d[/)]|[①-⑨])/],
];

function topCounts(values: readonly string[], k: number): { word: string; count: number }[] {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, k)
    .map(([word, count]) => ({ word, count }));
}

function pct(n: number, total: number): number {
  return total ? Math.round((n / total) * 1000) / 10 : 0;
}

/** 답 묶음의 말투 통계. 모델에게 주는 숫자와 카테고리 stats 가 같은 함수에서 나온다. */
export function measureReplies(replies: readonly string[]): CategoryStats {
  const list = replies.map((r) => r.trim()).filter(Boolean);
  const lengths = list.map(charLength).sort((a, b) => a - b);
  const sentences = list.map(countSentences).sort((a, b) => a - b);
  const habits: Record<string, number> = {};
  for (const [name, re] of HABITS) habits[name] = pct(list.filter((r) => re.test(r)).length, list.length);
  return {
    count: list.length,
    lengthMedian: percentile(lengths, 50),
    lengthP90: percentile(lengths, 90),
    sentencesMedian: percentile(sentences, 50),
    firstWords: topCounts(list.map(firstWord), 6),
    endings: topCounts(list.map(endingOf), 5).map(({ word, count }) => ({ ending: word, pct: pct(count, list.length) })),
    habits,
  };
}

/** 프롬프트에 싣는 한 줄 요약. */
export function statsLine(s: CategoryStats): string {
  const first = s.firstWords.map((w) => `"${w.word}" ${w.count}`).join(", ");
  const end = s.endings.map((e) => `${e.ending} ${e.pct}%`).join(", ");
  const habit = Object.entries(s.habits)
    .filter(([, v]) => v >= 5)
    .map(([k, v]) => `${k} ${v}%`)
    .join(", ");
  return `답 ${s.count}개 · 길이 중앙값 ${s.lengthMedian}자, 90%가 ${s.lengthP90}자 안 · 문장 중앙값 ${s.sentencesMedian}개 · 첫 마디: ${first || "-"} · 끝맺음: ${end || "-"} · 버릇: ${habit || "거의 없음"}`;
}

// ── 모델 출력 검증 (순수) ────────────────────────────────────────────

export interface DraftCategory {
  id: string;
  name: string;
  when: string;
  prompt: string;
  exampleIds: string[];
}

export interface CategoryDraftCheck {
  categories: DraftCategory[];
  /** 쌍 라벨(p001…) → 카테고리 id */
  assignments: Map<string, string>;
  /** 다시 물어야 하는 문제 */
  errors: string[];
  /** 받아들이되 요약에 남기는 문제 */
  warnings: string[];
}

export const MIN_CATEGORIES = 6;
export const MAX_CATEGORIES = 12;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_PROMPT_CHARS = 280;
const MAX_UNASSIGNED_RATIO = 0.1;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function toKebab(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function readCategory(raw: unknown, i: number, errors: string[], warnings: string[]): DraftCategory | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const id = toKebab(str(o.id)) || `category-${i + 1}`;
  const name = str(o.name);
  const when = str(o.when);
  const prompt = str(o.prompt);
  if (!name || !when || !prompt) {
    errors.push(`카테고리 ${i + 1}(${id}): name·when·prompt 중 빈 칸`);
    return null;
  }
  noteShape(str(o.id), { id, name, prompt }, errors, warnings);
  const exampleIds = Array.isArray(o.exampleIds) ? o.exampleIds.map(String) : [];
  return { id, name, when, prompt, exampleIds };
}

/** id 고침·이름 낱말 수는 경고, 짧은 지시문은 오류 */
function noteShape(rawId: string, c: Pick<DraftCategory, "id" | "name" | "prompt">, errors: string[], warnings: string[]): void {
  if (!KEBAB.test(rawId)) warnings.push(`id "${rawId}" → "${c.id}" 로 고침`);
  const words = c.name.split(/\s+/).length;
  if (words < 2 || words > 6) warnings.push(`이름 "${c.name}" 은 ${words}낱말 (2~6 권장)`);
  if (c.prompt.length < MIN_PROMPT_CHARS) errors.push(`${c.id}: 지시문이 ${c.prompt.length}자로 짧음 (${MIN_PROMPT_CHARS}자 이상)`);
}

function readAssignments(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const entries: [unknown, unknown][] = Array.isArray(raw)
    ? raw.filter(Array.isArray).map((e) => [e[0], e[1]] as [unknown, unknown])
    : Object.entries((raw ?? {}) as Record<string, unknown>);
  for (const [k, v] of entries) if (typeof k === "string" && typeof v === "string") out.set(k.trim(), toKebab(v));
  return out;
}

function checkCount(categories: readonly DraftCategory[], errors: string[]): void {
  if (categories.length < MIN_CATEGORIES || categories.length > MAX_CATEGORIES) {
    errors.push(`카테고리 ${categories.length}개 (${MIN_CATEGORIES}~${MAX_CATEGORIES}개여야 함)`);
  }
  const ids = categories.map((c) => c.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) errors.push(`id 중복: ${[...new Set(dup)].join(", ")}`);
}

function checkAssignments(assignments: Map<string, string>, labels: readonly string[], ids: ReadonlySet<string>, errors: string[], warnings: string[]): void {
  const missing = labels.filter((l) => !ids.has(assignments.get(l) ?? ""));
  if (missing.length > labels.length * MAX_UNASSIGNED_RATIO) {
    errors.push(`분류 안 된 답 ${missing.length}/${labels.length}개 (예: ${missing.slice(0, 8).join(", ")})`);
  } else if (missing.length) {
    warnings.push(`분류 안 된 답 ${missing.length}개`);
  }
}

/** 모델 JSON({categories, assignments})을 검사한다. labels = 프롬프트에 붙인 쌍 라벨 전체. */
export function checkCategoryDraft(raw: unknown, labels: readonly string[]): CategoryDraftCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const o = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(o.categories) ? o.categories : [];
  const categories = list.map((c, i) => readCategory(c, i, errors, warnings)).filter((c): c is DraftCategory => c !== null);
  checkCount(categories, errors);
  const assignments = readAssignments(o.assignments);
  checkAssignments(assignments, labels, new Set(categories.map((c) => c.id)), errors, warnings);
  return { categories, assignments, errors, warnings };
}

// ── 비율·예시 (순수) ────────────────────────────────────────────────

/** 카테고리별 소속 라벨. 없는 카테고리를 가리킨 라벨은 빠진다. */
export function membersByCategory(assignments: ReadonlyMap<string, string>, ids: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [label, id] of assignments) out.get(id)?.push(label);
  return out;
}

/** 비율(%) = 소속 수 / 전체 실제 답 수. 소수 첫째 자리. */
export function computeShares(members: ReadonlyMap<string, readonly string[]>, total: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, list] of members) out.set(id, pct(list.length, total));
  return out;
}

/**
 * 예시 4~8개: 모델이 고른 것 중 실제 소속인 것 → 모자라면 길이가 중앙값에 가까운 소속 답으로 채운다.
 * 소속이 4개보다 적으면 소속 전부.
 */
export function chooseExampleLabels(
  proposed: readonly string[],
  members: readonly string[],
  lengthOf: (label: string) => number,
  min = 4,
  max = 8
): string[] {
  const inCat = new Set(members);
  const picked = [...new Set(proposed.filter((l) => inCat.has(l)))].slice(0, max);
  if (picked.length >= min) return picked;
  const lens = members.map(lengthOf).sort((a, b) => a - b);
  const median = percentile(lens, 50);
  const rest = members
    .filter((l) => !picked.includes(l))
    .sort((a, b) => Math.abs(lengthOf(a) - median) - Math.abs(lengthOf(b) - median));
  return [...picked, ...rest].slice(0, Math.max(min, Math.min(max, picked.length)));
}

// ── 초안에서 쓰기 (순수) ────────────────────────────────────────────

function finiteOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 파일에서 읽은 JSON 을 계약 모양으로 좁힌다. 카테고리가 3개 미만이면 null (3벌을 못 만든다). */
export function parseCategoriesFile(raw: unknown): CategoriesFile | null {
  const o = (raw ?? {}) as Partial<CategoriesFile>;
  if (!Array.isArray(o.categories)) return null;
  const categories = o.categories.filter(
    (c): c is ReplyCategory => !!c && typeof c.id === "string" && typeof c.name === "string" && typeof c.prompt === "string"
  );
  if (categories.length < 3) return null;
  return {
    version: 1,
    personaId: String(o.personaId ?? ""),
    builtAt: String(o.builtAt ?? ""),
    model: String(o.model ?? ""),
    source: o.source ?? { pairs: 0, excluded: 0, unassigned: 0 },
    categories: categories.map((c) => ({
      ...c,
      when: String(c.when ?? ""),
      share: finiteOr(c.share, 0),
      exampleIds: Array.isArray(c.exampleIds) ? c.exampleIds.map(String) : [],
    })),
  };
}

// ── 파일 (I/O) ──────────────────────────────────────────────────────

export function categoriesPath(id: PersonaId): string {
  return packFile(id, "categories.json");
}

type CacheEntry = { mtimeMs: number; file: CategoriesFile | null };
function cache(): Map<string, CacheEntry> {
  const g = globalThis as typeof globalThis & { __replyCategoriesCache?: Map<string, CacheEntry> };
  g.__replyCategoriesCache ??= new Map();
  return g.__replyCategoriesCache;
}

/** 팩의 categories.json. 없거나 깨졌으면 null (초안기가 한 벌짜리로 돌아간다). */
export async function readCategories(id: PersonaId): Promise<CategoriesFile | null> {
  const file = categoriesPath(id);
  try {
    const s = await stat(file);
    const hit = cache().get(file);
    if (hit && hit.mtimeMs === s.mtimeMs) return hit.file;
    const parsed = parseCategoriesFile(JSON.parse(await readFile(file, "utf8")));
    cache().set(file, { mtimeMs: s.mtimeMs, file: parsed });
    return parsed;
  } catch {
    return null;
  }
}
