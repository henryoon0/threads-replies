// 적용·거절·되돌리기 — 규칙책(AGENTS.md)을 바꾸는 유일한 곳 (설계 4-5, 4-6).
//
// - 적용: backpass 제안의 찾기/바꾸기 쌍을 "원문에 정확히 한 번 있을 때만" 바꾼다. 어긋나면 추측하지 않고 멈춘다.
// - 안전 잠금: 처방약·용량(모든 팩)·제품/브랜드/구매처(strict 팩) 표현을 더하거나, `## 잠긴 규칙` 을
//   지우거나 바꾸거나, SAFETY.md 등 규칙책 밖을 바꾸는 제안은 코드가 자동으로 거절하고 이유를 남긴다.
// - 적용·규칙 지우기·규칙 더하기마다 팩에 git 커밋 하나. 되돌리기는 그 커밋을 git revert 한다.
// - 거절은 backpass 거절 저장소에 같은 열쇠로 적어, 새 증거 없이 같은 제안이 다시 오지 않게 한다.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyGateMode, checkGate, type GateRules } from "@/lib/personas/gate";
import { readGateRules } from "@/lib/personas/gate-rules";
import { learnBlockReason } from "@/lib/personas/knowledge/rows";
import type { PersonaConfig } from "@/lib/personas/model";
import {
  commitPackFiles,
  learningPaths,
  packGit,
  readJsonFile,
  readProposal,
  readText,
  recordRejection,
  rejectionKey,
  writeJsonAtomic,
  type BackpassEdit,
  type BackpassHunk,
} from "./backpass";
import type { Pattern, ReviewCard } from "./patterns";
import { appendLearnedRule, deletionSpan, isLockedUnit, parseRuleUnits, removeUnitLines, type RuleUnit } from "./rules";

// ── 안전 잠금 (순수) ────────────────────────────────────

export interface Safety {
  locked: boolean;
  reason?: string;
}

type EditLike = Pick<BackpassEdit, "file" | "kind" | "hunks"> & { skill?: BackpassEdit["skill"] };

const OPEN: Safety = { locked: false };
const lock = (reason: string): Safety => ({ locked: true, reason });
const SKILLS_PREFIX = ".claude/skills/";

function fileVerdict(edit: EditLike): Safety | null {
  if (edit.file === "SAFETY.md") return lock("안전 규칙(SAFETY.md)은 학습 대상이 아니에요. 코드가 자동으로 거절했어요.");
  if (edit.file !== "AGENTS.md") return lock(`규칙책(AGENTS.md) 밖의 ${edit.file} 을 바꾸는 제안이라 자동으로 거절했어요.`);
  const skillPath = edit.skill?.path ?? "";
  if (edit.kind === "extract" && (!skillPath.startsWith(SKILLS_PREFIX) || skillPath.includes(".."))) {
    return lock("기술 파일을 정해진 폴더(.claude/skills) 밖에 만드는 제안이라 자동으로 거절했어요.");
  }
  return null;
}

/** 바꾼 글에서 새로 들어가는 줄만 (원래 있던 줄은 앞뒤 맥락이라 빼고 본다) */
export function addedLines(hunk: Pick<BackpassHunk, "find" | "replace">): string[] {
  const before = new Set(hunk.find.split("\n").map((l) => l.trim()));
  return hunk.replace.split("\n").filter((l) => l.trim() && !before.has(l.trim()));
}

function wordingVerdict(texts: readonly string[], gate: PersonaConfig["gate"]): Safety | null {
  for (const text of texts) {
    const reason = learnBlockReason(text);
    if (!reason || (gate === "light" && reason === "제품·브랜드")) continue;
    return lock(`${reason} 표현을 규칙책에 넣는 제안이에요("${text.trim().slice(0, 40)}"). 코드가 자동으로 거절했어요.`);
  }
  return null;
}

// strict 팩(박약사): 안전 규칙(SAFETY.md)이 다루는 주제 바로 곁에 "빼·대신·말고·때만" 같은 말이 오면
// 그 규칙은 안전 안내를 줄이는 쪽이다. 규칙책은 SAFETY.md 뒤에 붙어 함께 읽히므로, 규칙책에서
// "경고는 조건이 있을 때만" 같은 문장이 들어가면 안전 규칙이 사실상 약해진다(2026-09-29 첫 패턴 분석에서 실제로 나옴).
// "하지 않는다"는 대상에 따라 뜻이 갈린다: "주의사항을 붙이지 않는다"는 약화, "진단하지 않는다"는 강화.
// 그래서 안전 "장치"(경고·진료 권유·근거 표시)에만 부정 표현을 보고, 조건(임신·신장…)에는 "빼·대신·때만"만 본다.
const MEASURE = "(안전|주의사항|주의|경고|병원|진료|의사|피검사|근거|상담|선긋|선을 긋)";
const CONDITION = "(임신|수유|항응고|와파린|신장|질환)";
const NEGATE = "(대신|말고|빼|지우|지운|생략|붙이지 않|쓰지 않|하지 않|넘기지 않|줄이)";
const DROP = "(대신|말고|빼|지우|지운|생략)";
const SAFETY_WEAKENING = [
  new RegExp(`${MEASURE}[^.!?\\n]{0,15}${NEGATE}`),
  new RegExp(`${DROP}[^.!?\\n]{0,6}${MEASURE}`),
  new RegExp(`${CONDITION}[^.!?\\n]{0,15}${DROP}`),
  new RegExp(`(${MEASURE}|${CONDITION})[^.!?\\n]{0,45}때만`),
];

function safetyTopicVerdict(texts: readonly string[], gate: PersonaConfig["gate"]): Safety | null {
  if (gate !== "strict") return null;
  const hit = texts.find((t) => SAFETY_WEAKENING.some((re) => re.test(t)));
  return hit
    ? lock(`안전 안내(진료 권유·경고·근거 표시 등)를 줄이는 규칙이에요("${hit.trim().slice(0, 40)}"). 안전 규칙과 부딪혀서 자동으로 거절했어요.`)
    : null;
}

/** 팩 관문 규칙(gate-rules.json)의 block 표현. light 팩은 block 을 확인으로 낮추므로 strict 팩에서만 잠근다. */
function gateRulesVerdict(texts: readonly string[], gate: PersonaConfig["gate"], rules?: GateRules): Safety | null {
  if (!rules || !texts.length) return null;
  const hit = applyGateMode(checkGate(texts.join("\n"), rules), gate).hits.find((h) => h.action === "block");
  return hit ? lock(`관문에 걸리는 표현("${hit.phrase}")을 규칙책에 넣는 제안이에요. ${hit.reason}`) : null;
}

const LOCKED_HEADING_LINE = /^#{1,6}\s+잠긴 규칙\s*$/m;

function lockedVerdict(hunks: readonly Pick<BackpassHunk, "find" | "replace">[], units: readonly RuleUnit[]): Safety | null {
  for (const h of hunks) {
    if (LOCKED_HEADING_LINE.test(h.find) && !LOCKED_HEADING_LINE.test(h.replace)) {
      return lock("잠긴 규칙 절을 지우는 제안이라 자동으로 거절했어요.");
    }
  }
  for (const unit of units.filter(isLockedUnit)) {
    const lines = unit.text.split("\n").map((l) => l.trim()).filter(Boolean);
    const touched = hunks.some((h) => lines.some((l) => h.find.includes(l) && !h.replace.includes(l)));
    if (touched) return lock(`잠긴 규칙 ${unit.id}을 지우거나 약하게 바꾸는 제안이에요. 코드가 자동으로 거절했어요.`);
  }
  return null;
}

/** 제안(또는 규칙 한 줄 더하기)이 안전 잠금에 걸리는가. gateRules 는 팩의 gate-rules.json (없으면 그 검사만 건너뜀). */
export function safetyVerdict(edit: EditLike, rulebookText: string, gate: PersonaConfig["gate"], gateRules?: GateRules): Safety {
  const added = [...edit.hunks.flatMap(addedLines), ...(edit.skill ? [edit.skill.description ?? "", edit.skill.body ?? ""] : [])];
  return (
    fileVerdict(edit) ??
    wordingVerdict(added, gate) ??
    gateRulesVerdict(added, gate, gateRules) ??
    safetyTopicVerdict(added, gate) ??
    lockedVerdict(edit.hunks, parseRuleUnits(rulebookText)) ??
    OPEN
  );
}

// ── 찾기/바꾸기 (순수) ──────────────────────────────────

/** 겹치는 경우까지 센다 — 같은 줄이 이어진 곳을 "한 번"으로 오판하지 않게 (backpass 와 같음) */
export function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) count += 1;
  return count;
}

export type HunkResult = { ok: true; text: string } | { ok: false; reason: string };

/** 모든 쌍이 지금 원문에 정확히 한 번 있을 때만 바꾼다. 하나라도 어긋나면 아무것도 안 바꾼다. */
export function applyHunks(text: string, hunks: readonly Pick<BackpassHunk, "find" | "replace">[]): HunkResult {
  let current = text;
  for (const [i, h] of hunks.entries()) {
    const n = occurrences(current, h.find);
    if (n !== 1) {
      const why = n === 0 ? "규칙책에서 더는 안 보여요" : `규칙책에 ${n}번 있어요`;
      return { ok: false, reason: `바꿀 부분 ${i + 1}이 ${why}. 규칙책이 제안 뒤에 바뀌었으니 다시 돌려 주세요.` };
    }
    current = current.replace(h.find, () => h.replace);
  }
  return { ok: true, text: current };
}

// ── 검토 파일 (private/review.json) ─────────────────────

export interface LearningReview {
  version: 1;
  persona: string;
  generatedAt: string;
  /** 패턴 분석 전이면 true (backpass 카드만 있음) */
  partial: boolean;
  backpass: {
    ran: boolean;
    generatedAt: string | null;
    transcripts: number;
    positive: number;
    negative: number;
    gapClusters: number;
    edits: number;
    violations: string[];
    notes: string[];
    error?: string;
  };
  patternsError?: string;
  /** 분석 당시 규칙책 {id → 해시}. 히트맵이 번호가 밀려도 같은 규칙에 성적을 붙인다. */
  rulesSnapshot: Record<string, string>;
  cards: ReviewCard[];
  timings: { backpassMs?: number; patternsMs?: number };
}

export async function readReview(id: string): Promise<LearningReview | null> {
  const r = await readJsonFile<LearningReview>(learningPaths(id).review);
  return r && r.version === 1 && Array.isArray(r.cards) ? r : null;
}

export async function writeReview(id: string, review: LearningReview): Promise<void> {
  await writeJsonAtomic(learningPaths(id).review, review);
}

async function patchCard(id: string, cardId: string, patch: Partial<ReviewCard>): Promise<void> {
  const review = await readReview(id);
  if (!review) return;
  review.cards = review.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c));
  await writeReview(id, review);
}

// ── 팩마다 한 번에 하나 (두 번 누름·동시 요청이 규칙책을 겹쳐 쓰지 않게) ─────

function packLocks(): Map<string, Promise<unknown>> {
  const g = globalThis as typeof globalThis & { __personaPackLocks?: Map<string, Promise<unknown>> };
  g.__personaPackLocks ??= new Map();
  return g.__personaPackLocks;
}

export function withPackLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const locks = packLocks();
  const run = (locks.get(id) ?? Promise.resolve()).then(fn, fn);
  locks.set(id, run.catch(() => undefined));
  return run;
}

// ── 결정 ───────────────────────────────────────────────

export type DecisionResult =
  | { status: "applied" | "rejected" | "deleted" | "added" | "reverted"; commit?: string; removed?: string[] }
  | { status: "locked" | "stale" | "missing" | "refused"; reason: string };

interface Located {
  card: ReviewCard;
  edit: BackpassEdit;
}

/** 검토 카드와 지금 proposal.json 의 같은 제안을 찾는다. 새 실행으로 제안이 바뀌었으면 stale. */
async function locate(id: string, pid: string): Promise<Located | DecisionResult> {
  const card = (await readReview(id))?.cards.find((c) => c.id === pid && c.type === "proposal");
  if (!card?.proposal) return { status: "missing", reason: "이 제안을 찾을 수 없어요." };
  const edit = (await readProposal(id))?.edits.find((e) => e.id === pid);
  if (!edit || rejectionKey(edit) !== card.proposal.rejectionKey) {
    return { status: "stale", reason: "제안이 새로 만들어졌어요. 화면을 새로고침해 주세요." };
  }
  return { card, edit };
}

const isResult = (v: Located | DecisionResult): v is DecisionResult => "status" in v;

function commitMessage(edit: BackpassEdit): string {
  const body = [edit.rationale, `backpass ${edit.kind} ${edit.id} · 대화 ${edit.transcripts}개`].filter(Boolean).join("\n\n");
  return `${edit.title}\n\n${body}`;
}

async function writeSkillFile(pack: string, edit: BackpassEdit): Promise<string[]> {
  if (edit.kind !== "extract" || !edit.skill) return [];
  const { skill } = edit;
  const body = `---\nname: ${skill.name ?? path.basename(path.dirname(skill.path))}\ndescription: ${skill.description ?? ""}\n---\n\n${skill.body ?? ""}\n`;
  const target = path.join(pack, skill.path);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body, "utf8");
  return [skill.path];
}

async function applyLocated(persona: PersonaConfig, { card, edit }: Located): Promise<DecisionResult> {
  const p = learningPaths(persona.id);
  const text = await readText(p.rulebook);
  // 카드를 만들 때 잠겼으면(모델이 본 안전 규칙 충돌 포함) 그대로 잠근다. 코드 검사는 지금 규칙책으로 다시 한다.
  const safety = card.safety.locked ? card.safety : safetyVerdict(edit, text, persona.gate, await readGateRules(persona.id));
  if (safety.locked) {
    await recordRejection(persona.id, edit, safety.reason);
    await patchCard(persona.id, edit.id, { status: "locked", reason: safety.reason, decidedAt: new Date().toISOString() });
    return { status: "locked", reason: safety.reason ?? "안전 잠금" };
  }
  const next = applyHunks(text, edit.hunks);
  if (!next.ok) return { status: "stale", reason: next.reason };
  await writeFile(p.rulebook, next.text, "utf8");
  const files = ["AGENTS.md", ...(await writeSkillFile(p.pack, edit))];
  const commit = await commitPackFiles(p.pack, files, commitMessage(edit));
  if (!commit) return { status: "stale", reason: "바뀐 내용이 없어요. 이미 적용된 제안일 수 있어요." };
  await patchCard(persona.id, edit.id, { status: "applied", commit, decidedAt: new Date().toISOString() });
  return { status: "applied", commit };
}

export function applyProposal(persona: PersonaConfig, pid: string): Promise<DecisionResult> {
  return withPackLock(persona.id, async () => {
    const found = await locate(persona.id, pid);
    if (isResult(found)) return found;
    if (found.card.status === "applied") return { status: "applied", commit: found.card.commit };
    return applyLocated(persona, found);
  });
}

export function rejectProposal(persona: PersonaConfig, pid: string): Promise<DecisionResult> {
  return withPackLock(persona.id, async () => {
    const found = await locate(persona.id, pid);
    if (isResult(found)) return found;
    if (found.card.status === "applied") return { status: "refused", reason: "이미 적용한 제안이에요. 되돌리기를 쓰세요." };
    await recordRejection(persona.id, found.edit);
    await patchCard(persona.id, pid, { status: "rejected", decidedAt: new Date().toISOString() });
    return { status: "rejected" };
  });
}

// ── 되돌리기 ─────────────────────────────────────────────

const SHA = /^[0-9a-f]{7,40}$/i;
const LEARNING_FILES = (f: string) => f === "AGENTS.md" || f.startsWith(SKILLS_PREFIX);

async function revertChecked(pack: string, commit: string): Promise<DecisionResult> {
  try {
    if ((await packGit(pack, ["cat-file", "-t", commit])) !== "commit") throw new Error("not a commit");
  } catch {
    return { status: "missing", reason: "팩에 그 커밋이 없어요." };
  }
  const files = (await packGit(pack, ["show", "--name-only", "--format=", commit])).split("\n").filter(Boolean);
  if (!files.length || !files.every(LEARNING_FILES)) {
    return { status: "refused", reason: "학습 적용 커밋(규칙책·기술 파일)만 되돌릴 수 있어요." };
  }
  try {
    await packGit(pack, ["revert", "--no-edit", commit]);
  } catch (e) {
    await packGit(pack, ["revert", "--abort"]).catch(() => undefined);
    return { status: "stale", reason: `그 뒤 바뀐 내용과 겹쳐서 되돌리지 못했어요: ${e instanceof Error ? e.message.slice(0, 120) : ""}` };
  }
  return { status: "reverted", commit: await packGit(pack, ["rev-parse", "HEAD"]) };
}

export function revertCommit(persona: PersonaConfig, commit: string): Promise<DecisionResult> {
  return withPackLock(persona.id, async () => {
    if (!SHA.test(commit)) return { status: "missing", reason: "커밋 해시 모양이 아니에요." };
    const result = await revertChecked(learningPaths(persona.id).pack, commit);
    if (result.status !== "reverted") return result;
    const review = await readReview(persona.id);
    for (const card of review?.cards.filter((c) => c.commit && commit.startsWith(c.commit.slice(0, commit.length))) ?? []) {
      await patchCard(persona.id, card.id, { status: "open", commit: undefined, reason: `되돌림 (${result.commit?.slice(0, 7)})` });
    }
    return result;
  });
}

// ── 규칙 지우기·더하기 (히트맵 · 패턴 카드) ─────────────────

async function deleteUnlocked(persona: PersonaConfig, ruleId: string, hash?: string): Promise<DecisionResult> {
  const p = learningPaths(persona.id);
  const text = await readText(p.rulebook);
  const units = parseRuleUnits(text);
  const index = units.findIndex((u) => u.id === ruleId);
  if (index < 0) return { status: "missing", reason: `규칙 ${ruleId}이 규칙책에 없어요.` };
  if (hash && units[index].hash !== hash) return { status: "stale", reason: "규칙책이 바뀌어 번호가 밀렸어요. 새로고침해 주세요." };
  const span = deletionSpan(units, index);
  const lockedId = span.ids.find((id) => isLockedUnit(units.find((u) => u.id === id) ?? { section: "" }));
  if (lockedId) return { status: "locked", reason: `잠긴 규칙 ${lockedId}은 지울 수 없어요.` };
  await writeFile(p.rulebook, removeUnitLines(text, span), "utf8");
  const subject = `Remove rule ${ruleId} from rulebook`;
  const commit = await commitPackFiles(p.pack, ["AGENTS.md"], `${subject}\n\n${units[index].text.slice(0, 300)}`);
  return commit ? { status: "deleted", commit, removed: span.ids } : { status: "stale", reason: "바뀐 내용이 없어요." };
}

export function deleteRule(persona: PersonaConfig, ruleId: string, hash?: string): Promise<DecisionResult> {
  return withPackLock(persona.id, () => deleteUnlocked(persona, ruleId, hash));
}

/** 패턴 카드에서 규칙을 더해도 되는가. 되면 null, 아니면 막는 결과. */
function addBlocker(card: ReviewCard, pattern: Pattern, rulebookText: string, persona: PersonaConfig, rules: GateRules): DecisionResult | null {
  const add = { file: "AGENTS.md", kind: "add" as const, hunks: [{ id: "h", find: "", replace: pattern.impliedRule }] };
  const safety = card.safety.locked ? card.safety : safetyVerdict(add, rulebookText, persona.gate, rules);
  if (safety.locked) return { status: "locked", reason: safety.reason ?? "안전 잠금" };
  if (!card.canAddRule) return { status: "refused", reason: `근거가 ${pattern.count}건뿐이에요. 서로 다른 답 3건 이상에서 보여야 규칙이 돼요.` };
  return null;
}

async function addUnlocked(persona: PersonaConfig, patternId: string): Promise<DecisionResult> {
  const card = (await readReview(persona.id))?.cards.find((c) => c.id === patternId && c.type === "pattern");
  const pattern = card?.patterns[0];
  if (!card || !pattern) return { status: "missing", reason: "이 패턴을 찾을 수 없어요." };
  if (card.status === "applied") return { status: "added", commit: card.commit };
  const p = learningPaths(persona.id);
  const text = await readText(p.rulebook);
  const blocked = addBlocker(card, pattern, text, persona, await readGateRules(persona.id));
  if (blocked) return blocked;
  await writeFile(p.rulebook, appendLearnedRule(text, pattern.impliedRule), "utf8");
  const commit = await commitPackFiles(p.pack, ["AGENTS.md"], `Add learned rule from pattern ${pattern.id}\n\n${pattern.title}\n${pattern.impliedRule}`);
  if (!commit) return { status: "stale", reason: "바뀐 내용이 없어요." };
  await patchCard(persona.id, patternId, { status: "applied", commit, decidedAt: new Date().toISOString() });
  return { status: "added", commit };
}

/** 패턴 카드의 "규칙으로 만들기": 규칙 문장을 `## 학습으로 더한 규칙` 에 한 줄 더하고 커밋 */
export function addPatternRule(persona: PersonaConfig, patternId: string): Promise<DecisionResult> {
  return withPackLock(persona.id, () => addUnlocked(persona, patternId));
}

/** 결정 결과 → HTTP 상태 (세 라우트가 같은 표를 쓴다). 잠금·어긋남·거부는 409, 없음은 404. */
export function decisionHttpStatus(result: DecisionResult): number {
  if (result.status === "missing") return 404;
  if (result.status === "locked" || result.status === "stale" || result.status === "refused") return 409;
  return 200;
}
