// 예시 은행 — 주인이 실제로 단 답 조각을 종류별로 모은 md 파일(팩 폴더 examples.md)과 그 선택기.
//
// 예전엔 종류마다 같은 조각 8개를 모든 댓글에 실었다. 그러면 모델이 그 8개의 표현을 댓글마다 되풀이한다
// ("고생이 많았어 진짜 화이팅이다" 가 모든 공감 답 끝에 붙던 원인).
// 이제는 댓글마다 다른 부분집합을 싣는다: 비슷한 댓글에 단 조각 몇 개 + 댓글 해시로 섞은 나머지(길이 골고루).
// 같은 댓글은 늘 같은 묶음(다시 써도 흔들리지 않게), 다른 댓글은 다른 묶음.
// 순수 — I/O 없음 (파일 읽기는 compose-run.ts).

import { createHash } from "node:crypto";
import { textSimilarity } from "@/lib/content-ideas-style-eval";
import { COMPOSE_KINDS, PRODUCT_CHANNELS, type ComposeKind, type ProductChannel } from "./compose-kinds";
import type { KindSegment } from "./compose-prompts";

/** ask = 주인이 정보가 모자란 댓글에 되물은 문장 (조각 종류와 따로 싣는다) */
export type BankKind = ComposeKind | "ask";
const BANK_KINDS: readonly BankKind[] = [...COMPOSE_KINDS, "ask"];

export interface BankEntry {
  kind: BankKind;
  pairId: string;
  /** 이 조각이 달린 댓글 (비슷한 댓글 찾기용) */
  comment: string;
  text: string;
  channel?: ProductChannel;
}

// ── md 파일 ─────────────────────────────────────────────────────────
//
// ## empathy
// - id: v123 | 댓글: 요즘 너무 피곤해요
//   답: 몸이 완전 지쳤다는 신호야. ...
// (제품은 "| 경로: pharmacy" 가 붙는다)

function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, " / ").trim();
}

export function renderExampleBank(entries: readonly BankEntry[], header: string): string {
  const parts = [header.trim(), ""];
  for (const kind of BANK_KINDS) {
    const list = entries.filter((e) => e.kind === kind);
    if (!list.length) continue;
    parts.push(`## ${kind}`, "");
    for (const e of list) {
      parts.push(`- id: ${e.pairId}${e.channel ? ` | 경로: ${e.channel}` : ""} | 댓글: ${oneLine(e.comment)}`, `  답: ${oneLine(e.text)}`);
    }
    parts.push("");
  }
  return parts.join("\n");
}

const HEAD = /^- id: (\S+)(?: \| 경로: (\w+))? \| 댓글: (.*)$/;

function kindOf(line: string): BankKind | null | undefined {
  const h2 = line.match(/^## (\w+)\s*$/);
  if (!h2) return undefined;
  return (BANK_KINDS as readonly string[]).includes(h2[1]) ? (h2[1] as BankKind) : null;
}

function entryOf(kind: BankKind, head: RegExpMatchArray, text: string): BankEntry {
  const channel = (PRODUCT_CHANNELS as readonly string[]).includes(head[2] ?? "") ? (head[2] as ProductChannel) : undefined;
  return { kind, pairId: head[1], comment: head[3], text: text.trim(), ...(channel ? { channel } : {}) };
}

export function parseExampleBank(md: string): BankEntry[] {
  const out: BankEntry[] = [];
  let kind: BankKind | null = null;
  let head: RegExpMatchArray | null = null;
  for (const line of md.split("\n")) {
    const k = kindOf(line);
    if (k !== undefined) kind = k;
    else if (HEAD.test(line)) head = line.match(HEAD);
    else {
      const body = line.match(/^\s+답: (.+)$/);
      if (body && head && kind) out.push(entryOf(kind, head, body[1]));
      if (body) head = null;
    }
  }
  return out;
}

// ── 선택기 ──────────────────────────────────────────────────────────

export interface PickInput {
  comment: string;
  kinds: readonly ComposeKind[];
  channels?: readonly ProductChannel[];
  /** 빼는 쌍 (평가의 시험 쌍 · 이 댓글 자기 답) */
  exclude?: ReadonlySet<string>;
  /** 종류마다 싣는 수 */
  perKind?: number;
  /** 비슷한 댓글에서 먼저 가져오는 수 */
  near?: number;
}

const NEAR_MIN_SIMILARITY = 0.12;

function rank(seed: string, id: string): string {
  return createHash("sha1").update(`${seed}\u0000${id}`).digest("hex");
}

function lengthBucket(text: string): number {
  const n = [...text].length;
  return n <= 40 ? 0 : n <= 120 ? 1 : 2;
}

function candidatesFor(kind: BankKind, bank: readonly BankEntry[], input: PickInput): BankEntry[] {
  const self = input.comment.trim();
  const list = bank.filter((e) => e.kind === kind && !input.exclude?.has(e.pairId) && e.comment.trim() !== self);
  if (kind !== "product" || !input.channels?.length) return list;
  const onChannel = list.filter((e) => e.channel && input.channels?.includes(e.channel));
  return onChannel.length ? onChannel : list;
}

/** 섞인 순서에서 아직 안 나온 길이대부터 하나씩 (짧은·중간·긴 조각이 고루 들게) */
function spreadByLength(shuffled: readonly BankEntry[], taken: readonly BankEntry[], n: number): BankEntry[] {
  const out: BankEntry[] = [];
  const pool = [...shuffled];
  while (out.length < n && pool.length) {
    const have = new Set([...taken, ...out].map((e) => lengthBucket(e.text)));
    const at = pool.findIndex((e) => !have.has(lengthBucket(e.text)));
    out.push(pool.splice(at >= 0 ? at : 0, 1)[0]);
  }
  return out;
}

function pickKind(kind: BankKind, bank: readonly BankEntry[], input: PickInput): BankEntry[] {
  const per = input.perKind ?? 4;
  const seen = new Set<string>();
  const unique = candidatesFor(kind, bank, input).filter((e) => (seen.has(e.pairId) ? false : (seen.add(e.pairId), true)));
  const near = unique
    .map((e) => ({ e, w: textSimilarity(input.comment, e.comment) }))
    .filter((x) => x.w >= NEAR_MIN_SIMILARITY)
    .sort((a, b) => b.w - a.w)
    .slice(0, Math.min(input.near ?? 2, per))
    .map((x) => x.e);
  const rest = unique.filter((e) => !near.includes(e)).sort((a, b) => rank(input.comment, a.pairId).localeCompare(rank(input.comment, b.pairId)));
  return [...near, ...spreadByLength(rest, near, per - near.length)];
}

/** 켠 종류마다 이 댓글에 실을 조각. 같은 쌍(답)에서는 종류마다 하나씩만. */
export function pickExamples(bank: readonly BankEntry[], input: PickInput): Partial<Record<ComposeKind, KindSegment[]>> {
  const out: Partial<Record<ComposeKind, KindSegment[]>> = {};
  for (const kind of input.kinds) {
    out[kind] = pickKind(kind, bank, input).map((e) => ({ pairId: e.pairId, text: e.text, ...(e.channel ? { channel: e.channel } : {}) }));
  }
  return out;
}

/** 주인이 실제로 되물은 문장 n 개 (댓글마다 다른 묶음, 비슷한 댓글 것 먼저). 되묻기 문구를 고정하지 않으려고 돌려 싣는다. */
export function pickAsks(bank: readonly BankEntry[], input: Pick<PickInput, "comment" | "exclude">, n = 3): string[] {
  return pickKind("ask", bank, { ...input, kinds: [], perKind: n, near: 1 }).map((e) => e.text);
}
