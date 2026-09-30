// 한 장씩 판결 (픽 16) — backpass 제안 하나마다 "이 주인의 패턴"을 더 정교하게 붙인다.
//
// henry 메모(2026-09-29): "그냥 결과값보다 오히려 조금 더 이 사람의 패턴을 한번 더 정교하게 분석해서
// 내용을 넣는 형태가 되어야해."
//
// 나누기:
//   - 코드: 기록에서 셀 수 있는 것(글자 수·끝맺음·이모지 변화, 몇 건인지)을 계산한다. 숫자는 전부 코드가 붙인다.
//   - 모델(Opus, 높은 노력, 1회): 기록 번호를 골라 패턴으로 묶고, 무엇을·언제 바꾸는지와 그 규칙 문장을 쓴다.
//     예시 3개는 모델이 번호만 고르고, 본문은 코드가 기록에서 그대로 꺼낸다(지어낸 예시가 들어갈 수 없다).
// 팩 폴더 밖(임시 폴더, 기록 안 남김)에서 돌린다 — 이 분석 대화가 다시 학습 재료가 되면 안 된다.

import { createHash } from "node:crypto";
import { runClaudeCLI } from "@/lib/ai/claude-cli";
import { parseJsonObject } from "@/lib/ai/json";
import type { GateRules } from "@/lib/personas/gate";
import type { PersonaConfig } from "@/lib/personas/model";
import { classifySituation, SITUATION_LABEL } from "@/lib/threads-replies/voice";
import { safetyVerdict, type Safety } from "./apply";
import type { BackpassEdit, BackpassProposal, EvidenceSummary } from "./backpass";
import { rejectionKey } from "./backpass";
import { parseRuleUnits, type RuleUnit } from "./rules";
import { isLearnable, type ReplyLogEntry } from "./stats";

export interface PatternExample {
  comment: string;
  aiDraft: string;
  final: string;
}

export interface Pattern {
  id: string;
  title: string;
  /** 2~3문장, 구체적으로 */
  insight: string;
  /** 언제 이렇게 고치는지 */
  when: string;
  examples: PatternExample[];
  /** 코드가 센 기록 수 */
  count: number;
  /** 이 패턴이 말하는 규칙 문장 (규칙책 말투) */
  impliedRule: string;
  relatedRuleIds: string[];
  relatedProposalIds: string[];
  /** 모델이 본 안전 규칙(SAFETY.md) 충돌 이유. 있으면 카드를 잠근다(잠그기만 하고 풀지는 않는다). */
  safetyConflict: string | null;
}

// ── 코드가 세는 것 ─────────────────────────────────────

const EMOJI = /\p{Extended_Pictographic}/gu;
const chars = (s: string) => Array.from(s.trim()).length;
const emojiCount = (s: string) => (s.match(EMOJI) ?? []).length;
const sentenceCount = (s: string) => s.split(/(?<=[.!?…~])\s+|\n+/).filter((x) => x.trim()).length;
const ending = (s: string) => Array.from(s.trim()).slice(-3).join("");

export interface EntryFacts {
  n: number;
  situation: string;
  draftLen: number;
  finalLen: number;
  editRatio: number | null;
  draftEnding: string;
  finalEnding: string;
  emojiDelta: number;
  sentenceDelta: number;
  identical: boolean;
}

function situationOf(persona: PersonaConfig, e: ReplyLogEntry): string {
  if (persona.gate === "strict") return /\?|？/.test(e.comment) ? "질문" : "반응·잡담";
  return SITUATION_LABEL[classifySituation(e.comment, e.final ?? "")];
}

export function entryFacts(persona: PersonaConfig, e: ReplyLogEntry, n: number): EntryFacts {
  const draft = e.aiDraft ?? "";
  const final = e.final ?? "";
  return {
    n,
    situation: situationOf(persona, e),
    draftLen: chars(draft),
    finalLen: chars(final),
    editRatio: e.editRatio,
    draftEnding: ending(draft),
    finalEnding: ending(final),
    emojiDelta: emojiCount(final) - emojiCount(draft),
    sentenceDelta: sentenceCount(final) - sentenceCount(draft),
    identical: draft.trim() === final.trim(),
  };
}

/** 분석에 넣을 기록: 학습 재료만, 최근 것부터 최대 max 개 */
export function patternEntries(entries: readonly ReplyLogEntry[], max = 120): ReplyLogEntry[] {
  return entries.filter(isLearnable).slice(-max);
}

// ── 프롬프트 ───────────────────────────────────────────

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function entryBlock(e: ReplyLogEntry, f: EntryFacts): string {
  const facts = `상황=${f.situation} · 길이 ${f.draftLen}→${f.finalLen} · 끝 "${f.draftEnding}"→"${f.finalEnding}" · 이모지 ${f.emojiDelta >= 0 ? "+" : ""}${f.emojiDelta} · 문장 ${f.sentenceDelta >= 0 ? "+" : ""}${f.sentenceDelta}${f.identical ? " · 그대로 보냄" : ""}`;
  return `#${f.n} [${facts}]\n댓글: ${clip(e.comment, 300)}\nAI 초안: ${clip(e.aiDraft ?? "", 400)}\n보낸 답: ${clip(e.final ?? "", 400)}`;
}

function proposalBlock(p: BackpassProposal | null): string {
  if (!p?.edits.length) return "(이번 주 backpass 제안 없음)";
  return p.edits
    .map((e) => `${e.id} [${e.kind}] ${e.title}\n  이유: ${clip(e.rationale, 300)}\n  건드리는 규칙: ${e.instructions.join(", ") || "없음"}`)
    .join("\n");
}

function evidenceBlock(s: EvidenceSummary | null): string {
  if (!s) return "(backpass 성적표 없음)";
  const rows = s.instructions
    .filter((r) => r.negative > 0 || r.positive > 0)
    .slice(0, 15)
    .map((r) => {
      const quotes = r.quotes.slice(0, 2).map((q) => `    ${q.polarity === "negative" ? "-" : "+"} ${clip(q.text, 160)}${q.effect ? ` (${clip(q.effect, 120)})` : ""}`);
      return [`- ${r.instruction} 지킴 ${r.positive} · 어김 ${r.negative}`, ...quotes].join("\n");
    });
  const gaps = s.gaps.slice(0, 8).map((g) => `- 없던 규칙 후보: ${clip(g.proposedInstruction, 200)}`);
  return [...rows, ...gaps].join("\n") || "(성적 없음)";
}

function rulesBlock(units: readonly RuleUnit[]): string {
  return units.map((u) => `${u.id} ${clip(u.text.replace(/\s+/g, " "), 110)}`).join("\n");
}

export interface PatternInput {
  persona: PersonaConfig;
  entries: readonly ReplyLogEntry[];
  proposal: BackpassProposal | null;
  summary: EvidenceSummary | null;
  rulebookText: string;
  /** SAFETY.md 전문 — 학습 대상이 아니다. 패턴·제안이 이것을 약하게 만드는지 보게 하려고 싣는다. */
  safetyText?: string;
}

export function patternPrompt(input: PatternInput): string {
  const { persona } = input;
  const owner = persona.ownerName;
  const facts = input.entries.map((e, i) => entryFacts(persona, e, i + 1));
  const safety =
    persona.gate === "strict"
      ? "\n- 처방약 이름·용량, 제품·브랜드·구매처 이름은 규칙 문장과 인사이트에 절대 쓰지 않는다. 그런 쪽으로 고친 패턴이면 버린다."
      : "";
  return `${persona.intro} ${owner}의 답글 기록을 분석해 줘. AI가 쓴 초안을 ${owner}가 실제로 보낼 때 어떻게 고치는지, 그 패턴을 정교하게 찾는 일이다.

## 기록 (번호 · 코드가 잰 차이 · 댓글 · AI 초안 · 실제로 보낸 답)
${input.entries.map((e, i) => entryBlock(e, facts[i])).join("\n\n")}

## 규칙책 (id · 앞부분)
${rulesBlock(parseRuleUnits(input.rulebookText))}

## 안전 규칙 (SAFETY.md, 학습 대상 아님 · 늘 규칙책과 함께 붙는다)
${input.safetyText?.trim() || "(없음)"}

## 이번 주 규칙책 수정 제안 (backpass)
${proposalBlock(input.proposal)}

## backpass 규칙 성적표와 근거 인용
${evidenceBlock(input.summary)}

## 할 일
${owner}가 AI 초안에서 꾸준히 바꾸는 것을 3~6개 패턴으로 묶어라. 겉으로 보이는 결과("짧게 줄였다")에서 멈추지 말고, 왜·어떤 상황에서·무엇을 무엇으로 바꾸는지까지 파고든다. 그대로 보낸 기록은 "잘 먹힌 규칙"의 근거로 쓴다.

규칙:
- 한 패턴은 기록 2개 이상에서 보여야 한다. entries 에 그 기록 번호를 전부 적는다.
- examples 에는 그 패턴이 가장 또렷한 기록 번호 3개를 적는다(본문은 코드가 붙인다).
- title: ${owner}를 주어로 한 짧은 문장. 예: "${owner}는 감사 답에 이름 대신 서명 이모지를 붙인다"
- insight: 2~3문장. 구체적으로 — 무엇을 지우고 무엇을 넣는지, 초안의 어떤 버릇이 문제인지. 기록의 짧은 표현을 따옴표로 인용해도 된다.
- when: 이 패턴이 나오는 상황 한 문장.
- impliedRule: 규칙책에 그대로 넣을 수 있는 한 문장(규칙책 말투, "~한다."로 끝).
- 숫자·개수·비율(몇 번, 몇 %, 몇 개)은 title·insight·when 에 쓰지 않는다. 개수는 코드가 센다.
- relatedRuleIds: 이 패턴과 관련된 규칙책 id(위 목록에 있는 것만). relatedProposalIds: 관련된 제안 id(위 목록에 있는 것만).
- safetyConflict: impliedRule 을 규칙책에 넣으면 안전 규칙의 어느 줄이든 약해지거나 피해 가게 되면 그 이유 한 문장, 아니면 "". 주인이 실제로 안전 문구를 뺐더라도 규칙이 되면 AI 가 안전 안내를 빼게 되니 표시한다.${safety}

제안이 있으면 proposalNotes 에 제안마다 하나씩: 개발자가 아닌 ${owner}가 읽을 쉬운 한국어 제목(title, 한 문장)과 왜 바꾸자는지 한 문장(why). 규칙 id·영어 약어는 쓰지 않는다. 그 제안이 안전 규칙을 약하게 만들면 safetyConflict 에 이유 한 문장, 아니면 "".

JSON 하나만 출력:
{"patterns":[{"title":"","insight":"","when":"","entries":[1,2],"examples":[1,2],"impliedRule":"","relatedRuleIds":[],"relatedProposalIds":[],"safetyConflict":""}],"proposalNotes":[{"id":"e1","title":"","why":"","safetyConflict":""}]}`;
}

// ── 검증 ───────────────────────────────────────────────

const COUNT_WORDS = /\d+(\.\d+)?\s*(번|개|건|회|%|퍼센트|명|쌍|차례)/;
const MIN_PATTERN_COUNT = 2;

/** 개수를 말하는 문장은 뺀다(숫자는 코드가 붙인다). */
export function stripCountSentences(text: string): string {
  return text
    .split(/(?<=[.!?。])\s+/)
    .filter((s) => !COUNT_WORDS.test(s))
    .join(" ")
    .trim();
}

type RawPattern = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const ints = (v: unknown, max: number) =>
  [...new Set(Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= max) : [])];
const idsIn = (v: unknown, allowed: ReadonlySet<string>) =>
  [...new Set(Array.isArray(v) ? v.map(String).filter((x) => allowed.has(x)) : [])];

export interface PatternContext {
  entries: readonly ReplyLogEntry[];
  ruleIds: ReadonlySet<string>;
  proposalIds: ReadonlySet<string>;
}

function exampleOf(e: ReplyLogEntry): PatternExample {
  return { comment: e.comment, aiDraft: e.aiDraft ?? "", final: e.final ?? "" };
}

function toPattern(raw: RawPattern, ctx: PatternContext): Pattern | null {
  const entryNums = ints(raw.entries, ctx.entries.length);
  const title = s(raw.title).replace(COUNT_WORDS, "").trim();
  const insight = stripCountSentences(s(raw.insight));
  const impliedRule = s(raw.impliedRule);
  if (entryNums.length < MIN_PATTERN_COUNT || !title || !insight || !impliedRule) return null;
  const picked = ints(raw.examples, ctx.entries.length).filter((n) => entryNums.includes(n));
  const exampleNums = [...new Set([...picked, ...entryNums])].slice(0, 3);
  return {
    id: `pt-${createHash("sha1").update(title).digest("hex").slice(0, 8)}`,
    title: title.slice(0, 80),
    insight,
    when: stripCountSentences(s(raw.when)),
    examples: exampleNums.map((n) => exampleOf(ctx.entries[n - 1])),
    count: entryNums.length,
    impliedRule,
    relatedRuleIds: idsIn(raw.relatedRuleIds, ctx.ruleIds),
    relatedProposalIds: idsIn(raw.relatedProposalIds, ctx.proposalIds),
    safetyConflict: s(raw.safetyConflict) || null,
  };
}

/** 제안마다 쉬운 한국어 제목·이유 (backpass 제목은 영어라서) */
export interface ProposalNote {
  id: string;
  title: string;
  why: string;
  safetyConflict: string | null;
}

export interface PatternAnalysis {
  patterns: Pattern[];
  notes: ProposalNote[];
}

function toPatterns(list: unknown, ctx: PatternContext): Pattern[] {
  const out: Pattern[] = [];
  for (const item of Array.isArray(list) ? (list as RawPattern[]) : []) {
    const p = item && typeof item === "object" ? toPattern(item, ctx) : null;
    if (p && !out.some((o) => o.id === p.id)) out.push(p);
  }
  return out.sort((a, b) => b.count - a.count);
}

function toNotes(list: unknown, ctx: PatternContext): ProposalNote[] {
  return (Array.isArray(list) ? (list as RawPattern[]) : [])
    .map((n) => ({
      id: s(n?.id),
      title: s(n?.title).replace(COUNT_WORDS, "").trim(),
      why: stripCountSentences(s(n?.why)),
      safetyConflict: s(n?.safetyConflict) || null,
    }))
    .filter((n) => ctx.proposalIds.has(n.id) && n.title);
}

/** 모델 출력 → 검증된 패턴·제안 메모. 기록 번호가 틀리거나 근거가 모자란 패턴은 버린다. */
export function parsePatternOutput(raw: string, ctx: PatternContext): PatternAnalysis {
  const parsed = parseJsonObject<{ patterns?: unknown; proposalNotes?: unknown }>(raw);
  return { patterns: toPatterns(parsed.patterns, ctx), notes: toNotes(parsed.proposalNotes, ctx) };
}

export function parsePatterns(raw: string, ctx: PatternContext): Pattern[] {
  return parsePatternOutput(raw, ctx).patterns;
}

// ── 실행 ───────────────────────────────────────────────

const DEFAULT_PATTERN_TIMEOUT_MS = 15 * 60 * 1000;
const MIN_PATTERN_TIMEOUT_MS = 10 * 60 * 1000;

/** PERSONA_PATTERNS_TIMEOUT_MS: 양수·유한만 받고, 10분보다 짧으면 10분 (Opus 높은 노력 한 번이 수 분 걸린다) */
export function patternTimeoutMs(raw = process.env.PERSONA_PATTERNS_TIMEOUT_MS): number {
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  const v = Number.isFinite(n) && n > 0 ? n : DEFAULT_PATTERN_TIMEOUT_MS;
  return Math.max(MIN_PATTERN_TIMEOUT_MS, v);
}

export async function analyzePatterns(
  input: PatternInput,
  opts: { deadlineMs?: number; signal?: AbortSignal } = {}
): Promise<PatternAnalysis> {
  const entries = patternEntries(input.entries);
  if (entries.length < MIN_PATTERN_COUNT) return { patterns: [], notes: [] };
  const prompt = patternPrompt({ ...input, entries });
  const raw = await runClaudeCLI(prompt, {
    model: "claude-opus-5-5",
    effort: "high",
    timeoutMs: patternTimeoutMs(),
    deadlineMs: opts.deadlineMs,
    signal: opts.signal,
    requireClaude: true,
  });
  return parsePatternOutput(raw, {
    entries,
    ruleIds: new Set(parseRuleUnits(input.rulebookText).map((u) => u.id)),
    proposalIds: new Set((input.proposal?.edits ?? []).map((e) => e.id)),
  });
}

// ── 카드 합치기 ─────────────────────────────────────────

export interface ProposalView {
  id: string;
  kind: BackpassEdit["kind"];
  title: string;
  rationale: string;
  instructions: string[];
  transcripts: number;
  deltaTokens: number;
  applicable: boolean;
  hunks: { find: string; replace: string }[];
  rejectionKey: string;
  /** 쉬운 한국어 제목·이유 (패턴 분석이 붙임, 없으면 null) */
  plainTitle: string | null;
  plainWhy: string | null;
}

export interface CardEvidence {
  polarity: "positive" | "negative" | "neutral";
  text: string;
  source: string;
  /** 근거 대화가 학습 기록과 이어지면: 실제 댓글 · AI 초안 · 보낸 답 */
  triplet: PatternExample | null;
}

export type CardStatus = "open" | "applied" | "rejected" | "locked";

export interface ReviewCard {
  /** 제안 카드 = 제안 id(e1…), 패턴 카드 = 패턴 id(pt-…) */
  id: string;
  type: "proposal" | "pattern";
  status: CardStatus;
  proposal: ProposalView | null;
  patterns: Pattern[];
  evidence: CardEvidence[];
  safety: Safety;
  /** 패턴 카드만: 규칙으로 만들 수 있나 (최소 증거 3건) */
  canAddRule?: boolean;
  commit?: string;
  decidedAt?: string;
  reason?: string;
}

/** 근거 출처 "claude · 45efdc76 · 2026-09-29" → 그 대화의 학습 기록 */
export function entryForSource(source: string, entries: readonly ReplyLogEntry[]): ReplyLogEntry | null {
  const short = source.split("·")[1]?.trim();
  if (!short || short.length < 6) return null;
  return entries.find((e) => e.sessionId?.startsWith(short)) ?? null;
}

function cardEvidence(edit: BackpassEdit, entries: readonly ReplyLogEntry[]): CardEvidence[] {
  return edit.evidence.map((ev) => {
    const e = entryForSource(ev.source, entries);
    return { polarity: ev.polarity, text: ev.text, source: ev.source, triplet: e && isLearnable(e) ? exampleOf(e) : null };
  });
}

function proposalView(edit: BackpassEdit, note: ProposalNote | undefined): ProposalView {
  return {
    plainTitle: note?.title ?? null,
    plainWhy: note?.why ?? null,
    id: edit.id,
    kind: edit.kind,
    title: edit.title,
    rationale: edit.rationale,
    instructions: edit.instructions,
    transcripts: edit.transcripts,
    deltaTokens: edit.deltaTokens ?? 0,
    applicable: edit.applicable !== false,
    hunks: edit.hunks.map((h) => ({ find: h.find, replace: h.replace })),
    rejectionKey: rejectionKey(edit),
  };
}

function patternsFor(edit: BackpassEdit, patterns: readonly Pattern[]): Pattern[] {
  return patterns.filter(
    (p) => p.relatedProposalIds.includes(edit.id) || p.relatedRuleIds.some((id) => edit.instructions.includes(id))
  );
}

export interface CardInput {
  persona: PersonaConfig;
  proposal: BackpassProposal | null;
  patterns: readonly Pattern[];
  notes?: readonly ProposalNote[];
  entries: readonly ReplyLogEntry[];
  rulebookText: string;
  minEvidence: number;
  /** 팩 gate-rules.json — block 표현을 더하는 제안·규칙을 잠근다 */
  gateRules?: GateRules;
}

/** 코드 검사가 먼저, 열려 있으면 모델이 본 안전 규칙 충돌로 잠근다(모델은 잠그기만 한다). */
export function withConflict(code: Safety, conflict: string | null | undefined): Safety {
  if (code.locked || !conflict) return code;
  return { locked: true, reason: `안전 규칙과 부딪혀요: ${conflict} 그래서 자동으로 막았어요.` };
}

/** 제안마다 카드 하나(패턴·근거·안전 잠금 포함) + 어느 제안에도 안 붙은 패턴은 따로 카드 */
export function buildCards(input: CardInput): ReviewCard[] {
  const used = new Set<string>();
  const cards: ReviewCard[] = (input.proposal?.edits ?? []).map((edit) => {
    const related = patternsFor(edit, input.patterns);
    related.forEach((p) => used.add(p.id));
    const note = input.notes?.find((n) => n.id === edit.id);
    const safety = withConflict(safetyVerdict(edit, input.rulebookText, input.persona.gate, input.gateRules), note?.safetyConflict);
    return {
      id: edit.id,
      type: "proposal",
      status: safety.locked ? "locked" : "open",
      proposal: proposalView(edit, note),
      patterns: related,
      evidence: cardEvidence(edit, input.entries),
      safety,
    };
  });
  for (const p of input.patterns.filter((x) => !used.has(x.id))) {
    const safety = withConflict(
      safetyVerdict({ file: "AGENTS.md", kind: "add", hunks: [{ id: p.id, find: "", replace: p.impliedRule }] }, input.rulebookText, input.persona.gate, input.gateRules),
      p.safetyConflict
    );
    cards.push({
      id: p.id,
      type: "pattern",
      status: safety.locked ? "locked" : "open",
      proposal: null,
      patterns: [p],
      evidence: [],
      safety,
      canAddRule: !safety.locked && p.count >= input.minEvidence,
    });
  }
  return cards;
}
