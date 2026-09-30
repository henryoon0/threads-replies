// 규칙책 히트맵 (픽 17) — AGENTS.md 를 backpass 와 똑같이 규칙 단위(AG-001…)로 쪼개고,
// backpass 성적표(.backpass/evidence-summary.json)의 규칙별 지킴·어김을 붙인다.
//
// 쪼개는 법은 backpass v0.1.3 memory.js parseMemoryUnits 를 그대로 옮겼다.
// id 가 하나라도 어긋나면 성적이 엉뚱한 규칙에 붙으므로, 실제 규칙책으로 backpass 와 대조하는 테스트가 있다.
// Pure — I/O 없음 (지우기의 파일·git 은 apply.ts).

import { createHash } from "node:crypto";
import { estimateTokens } from "./stats";

export interface RuleUnit {
  id: string;
  /** backpass 와 같은 내용 해시 — 규칙책이 바뀐 뒤에도 같은 규칙을 다시 찾는 열쇠 */
  hash: string;
  tokens: number;
  text: string;
  /** 제목 경로 "a > b" */
  section: string;
  /** 1부터 시작, 포함 */
  startLine: number;
  /** 다음 경계 줄(빈 줄·제목)의 0-기준 번호 = 마지막 줄의 1-기준 번호 */
  endLine: number;
}

const FENCE = /^\s*(```|~~~)/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+/;
const HEADING = /^(#{1,6})\s+(.*)$/;

function normalizeForHash(text: string): string {
  return text.toLowerCase().replace(/[`*_~]/g, "").replace(/\s+/g, " ").trim();
}

export function unitHash(text: string): string {
  return createHash("sha256").update(normalizeForHash(text), "utf8").digest("hex").slice(0, 12);
}

const alias = (i: number) => `AG-${String(i + 1).padStart(3, "0")}`;

interface Draft {
  text: string;
  section: string;
  startLine: number;
  endLine: number;
}

class UnitSplitter {
  units: Draft[] = [];
  headings: string[] = [];
  buffer: string[] = [];
  bufferStart = 0;
  inFence = false;
  fenceMarker: string | null = null;

  flush(endLine: number): void {
    const raw = this.buffer.join("\n");
    if (raw.trim()) {
      this.units.push({ text: raw.replace(/\s+$/, ""), section: this.headings.join(" > "), startLine: this.bufferStart + 1, endLine });
    }
    this.buffer = [];
  }

  /** 코드 울타리 줄이거나 울타리 안이면 true (문단에 붙인다) */
  fence(line: string, i: number): boolean {
    if (FENCE.test(line)) {
      const marker = line.trim().slice(0, 3);
      if (!this.inFence) {
        this.inFence = true;
        this.fenceMarker = marker;
      } else if (marker === this.fenceMarker) {
        this.inFence = false;
      }
      if (!this.buffer.length) this.bufferStart = i;
      this.buffer.push(line);
      return true;
    }
    if (this.inFence) this.buffer.push(line);
    return this.inFence;
  }

  heading(line: string, i: number): boolean {
    const m = line.match(HEADING);
    if (!m) return false;
    this.flush(i);
    const depth = m[1].length;
    this.headings.length = Math.min(this.headings.length, depth - 1);
    this.headings[depth - 1] = m[2].trim();
    for (let d = 0; d < depth - 1; d += 1) this.headings[d] = this.headings[d] ?? "";
    return true;
  }

  line(line: string, i: number): void {
    if (this.fence(line, i) || this.heading(line, i)) return;
    if (line.trim() === "") {
      this.flush(i);
      return;
    }
    if (LIST_ITEM.test(line) && this.buffer.length && LIST_ITEM.test(this.buffer[0])) this.flush(i);
    if (!this.buffer.length) this.bufferStart = i;
    this.buffer.push(line);
  }
}

/** backpass parseMemoryUnits 와 같은 결과. 목록 한 줄·문단 하나가 규칙 하나. */
export function parseRuleUnits(text: string): RuleUnit[] {
  const lines = text.split("\n");
  const splitter = new UnitSplitter();
  lines.forEach((line, i) => splitter.line(line, i));
  splitter.flush(lines.length);
  return splitter.units.map((u, i) => ({ id: alias(i), hash: unitHash(u.text), tokens: estimateTokens(u.text), ...u }));
}

// ── 잠긴 규칙 ───────────────────────────────────────────

export const LOCKED_HEADING = "잠긴 규칙";

/** `## 잠긴 규칙` 아래(하위 제목 포함)에 있는 규칙인가 */
export function isLockedUnit(unit: Pick<RuleUnit, "section">): boolean {
  return unit.section.split(" > ").some((h) => h.trim() === LOCKED_HEADING);
}

// ── 히트맵 ─────────────────────────────────────────────

export interface EvidenceRow {
  instruction: string;
  positive: number;
  negative: number;
  sessions: number;
  relevance: number;
}

export interface RuleRow {
  id: string;
  hash: string;
  section: string;
  text: string;
  line: number;
  tokens: number;
  positive: number;
  negative: number;
  sessions: number;
  relevance: number;
  locked: boolean;
}

/**
 * 규칙마다 성적을 붙인다. 성적표 id 는 분석 당시 규칙책 기준이라, 그 뒤 규칙을 더하거나 지우면
 * 번호가 밀린다. 그래서 분석 당시의 {id → 해시} 표(snapshot)가 있으면 해시로 잇고, 없으면 id 로 잇는다.
 */
export function ruleHeatmap(
  text: string,
  evidence: readonly EvidenceRow[],
  snapshot: Readonly<Record<string, string>> | null = null
): RuleRow[] {
  const byKey = new Map<string, EvidenceRow>();
  for (const row of evidence) {
    const key = snapshot ? snapshot[row.instruction] : row.instruction;
    if (key) byKey.set(key, row);
  }
  return parseRuleUnits(text).map((u) => {
    const ev = byKey.get(snapshot ? u.hash : u.id);
    return {
      id: u.id,
      hash: u.hash,
      section: u.section,
      text: u.text,
      line: u.startLine,
      tokens: u.tokens,
      positive: ev?.positive ?? 0,
      negative: ev?.negative ?? 0,
      sessions: ev?.sessions ?? 0,
      relevance: ev?.relevance ?? 0,
      locked: isLockedUnit(u),
    };
  });
}

/** 분석 당시 규칙책의 {id → 해시} 표 */
export function unitSnapshot(text: string): Record<string, string> {
  return Object.fromEntries(parseRuleUnits(text).map((u) => [u.id, u.hash]));
}

// ── 지우기·더하기 (글만 바꾼다) ─────────────────────────────

const indentOf = (text: string) => (text.match(/^\s*/)?.[0].length ?? 0);

/**
 * 지울 범위: 규칙 하나 + 바로 아래에 더 들여 쓴 목록(그 규칙의 예시 줄).
 * backpass 는 들여 쓴 예시도 따로 세지만, 부모 규칙만 지우면 예시가 앞 규칙 밑에 고아로 남는다.
 */
export function deletionSpan(units: readonly RuleUnit[], index: number): { startLine: number; endLine: number; ids: string[] } {
  const head = units[index];
  const ids = [head.id];
  let endLine = head.endLine;
  if (LIST_ITEM.test(head.text)) {
    for (let i = index + 1; i < units.length; i += 1) {
      const u = units[i];
      if (u.startLine !== endLine + 1 || !LIST_ITEM.test(u.text) || indentOf(u.text) <= indentOf(head.text)) break;
      ids.push(u.id);
      endLine = u.endLine;
    }
  }
  return { startLine: head.startLine, endLine, ids };
}

/** 규칙 한 단위의 줄을 지운다. 앞뒤가 모두 빈 줄이면 빈 줄 하나도 같이 지워 두 줄 공백을 남기지 않는다. */
export function removeUnitLines(text: string, unit: Pick<RuleUnit, "startLine" | "endLine">): string {
  const lines = text.split("\n");
  let from = unit.startLine - 1;
  const to = unit.endLine; // exclusive
  const blankBefore = from === 0 || lines[from - 1]?.trim() === "";
  const blankAfter = to >= lines.length || lines[to]?.trim() === "";
  if (blankBefore && blankAfter && from > 0) from -= 1;
  lines.splice(from, to - from);
  return lines.join("\n");
}

export const LEARNED_SECTION = "## 학습으로 더한 규칙";

/** 새 규칙 한 줄을 `## 학습으로 더한 규칙` 끝에 목록으로 붙인다(없으면 절을 만든다). */
export function appendLearnedRule(text: string, rule: string): string {
  const line = `- ${rule.replace(/\s+/g, " ").trim()}`;
  const lines = text.replace(/\s+$/, "").split("\n");
  const at = lines.findIndex((l) => l.trim() === LEARNED_SECTION);
  if (at < 0) return `${lines.join("\n")}\n\n${LEARNED_SECTION}\n\n${line}\n`;
  let end = at + 1;
  while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end += 1;
  while (end > at + 1 && lines[end - 1].trim() === "") end -= 1;
  const needsGap = end === at + 1;
  lines.splice(end, 0, ...(needsGap ? ["", line] : [line]));
  return `${lines.join("\n")}\n`;
}
