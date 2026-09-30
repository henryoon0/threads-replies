// backpass 다리 — 팩 폴더에서 backpass(규칙책 학습기 v0.1.3)를 돌리고, 그 상태 파일을 읽고 쓴다.
//
// backpass 는 제안만 만들고 파일은 쓰지 않는다(전체 패스). 적용은 apply.ts 가 한다 —
// v0.1.3 의 브라우저 승인 화면은 실제로 파일을 안 썼다(메모 backpass-agents-training).
// 상태 파일 모양은 backpass 소스(state.js·proposal.js·fold.js)를 따른다. 버전을 올리면 테스트부터 확인한다.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { augmentedPath, killProcessTree, resolveCliBin } from "@/lib/cli-bin";
import { packDir, packPrivateDir } from "@/lib/personas/registry";

// ── 예산·설정 ───────────────────────────────────────────

/** 규칙책 크기 상한(토큰). 설계 4-5: AICC 3,500 · 박약사 3,000 */
const BUDGETS: Readonly<Record<string, number>> = { glp1: 3000, me: 3500 };
const DEFAULT_BUDGET = 3000;

export function learningBudget(id: string): number {
  return BUDGETS[id] ?? DEFAULT_BUDGET;
}

/**
 * 모델은 Claude 구독으로 고정한다(자동 고르기를 끈다). 2026-09-29 실측:
 *   - 자동 고르기 1순위 pi(gpt-5.6-luna)는 이 맥에서 시작 안내문(스킬 목록)을 출력해 분석 41건이 전부 "JSON 없음"으로 실패.
 *   - acpx 에 묶인 Claude Code(2.1.215)는 claude-opus-5-5 를 못 돌리고, 세션 모델 값으로 "claude-opus-5" 도 거절한다
 *     → 제안(synthesis)은 별칭 "opus"(그 버전이 돌릴 수 있는 최신 Opus). 분석은 "claude-sonnet-5" 가 받아진다.
 */
export function backpassConfig(id: string): Record<string, unknown> {
  return {
    memoryFiles: ["AGENTS.md"],
    budgetTokens: learningBudget(id),
    minGapEvidence: 3,
    maxTranscripts: 100,
    skillsDir: ".claude/skills",
    analysis: { agent: "claude", model: "claude-sonnet-5", effort: "medium" },
    synthesis: { agent: "claude", model: "opus", effort: "high" },
    discovery: { harnesses: ["claude", "codex"], since: "30d", minUserTurns: 2 },
  };
}

export function learningPaths(id: string) {
  const pack = packDir(id);
  const priv = packPrivateDir(id);
  return {
    pack,
    rulebook: path.join(pack, "AGENTS.md"),
    safety: path.join(pack, "SAFETY.md"),
    config: path.join(pack, ".backpassrc.json"),
    proposal: path.join(pack, ".backpass", "proposal.json"),
    summary: path.join(pack, ".backpass", "evidence-summary.json"),
    rejections: path.join(pack, ".backpass", "rejections.json"),
    replyLog: path.join(priv, "reply-log.jsonl"),
    job: path.join(priv, "learning-job.json"),
    review: path.join(priv, "review.json"),
  };
}

// ── 파일 ───────────────────────────────────────────────

export async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

export async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

// ── 팩 git ─────────────────────────────────────────────

const execFileP = promisify(execFile);
const GIT_TIMEOUT_MS = 15_000;

export async function packGit(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP("git", ["-C", dir, ...args], {
    timeout: GIT_TIMEOUT_MS,
    env: { ...process.env, PATH: augmentedPath() },
  });
  return stdout.trim();
}

/** 지정 파일만 커밋하고 새 커밋 해시를 돌려준다. 바뀐 게 없으면 null. */
export async function commitPackFiles(dir: string, files: string[], message: string): Promise<string | null> {
  await packGit(dir, ["add", "--", ...files]);
  const staged = await packGit(dir, ["diff", "--cached", "--name-only", "--", ...files]);
  if (!staged) return null;
  await packGit(dir, ["commit", "-m", message, "--", ...files]);
  return packGit(dir, ["rev-parse", "HEAD"]);
}

/** .backpassrc.json 을 페르소나 설정에 맞춘다. 바뀌었을 때만 쓰고 팩에 커밋한다. */
export async function ensureBackpassConfig(id: string): Promise<boolean> {
  const p = learningPaths(id);
  const want = `${JSON.stringify(backpassConfig(id), null, 2)}\n`;
  if ((await readText(p.config)) === want) return false;
  await writeFile(p.config, want, "utf8");
  await commitPackFiles(p.pack, [".backpassrc.json"], "Set backpass config for weekly learning");
  return true;
}

// ── backpass 실행 ───────────────────────────────────────

export interface BackpassRun {
  code: number | null;
  stdout: string;
  /** stderr 마지막 몇 줄 (실패 이유 보기용) */
  stderrTail: string;
}

export interface RunBackpassOpts {
  timeoutMs: number;
  signal?: AbortSignal;
  /** stderr 진행 줄이 올 때마다 (하트비트·진행 표시용) */
  onLine?: (line: string) => void;
}

function tailLines(text: string, n: number): string {
  return text.split("\n").filter(Boolean).slice(-n).join("\n");
}

/**
 * 팩 폴더에서 `backpass --json --strict` 전체 패스(수집 → 분석 → 합산 → 제안)를 돌린다. 파일은 쓰지 않는다.
 * --strict: 작업 폴더가 정확히 팩인 대화만 쓴다. 안 붙이면 "지워진 폴더 이름이 aicc" 인 henry 의 다른
 * 프로젝트 대화(workspace/aicc)까지 이 팩 학습 재료로 끌려온다(2026-09-29 실측 11건).
 * 분리된 프로세스 그룹으로 띄워, 시간 초과·취소 때 acpx·모델 자식까지 한꺼번에 죽인다.
 */
export function runBackpass(dir: string, opts: RunBackpassOpts): Promise<BackpassRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveCliBin("backpass"), ["--json", "--strict"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: augmentedPath(), NO_COLOR: "1" },
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    const finish = (fn: () => void) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const timer = setTimeout(() => {
      killProcessTree(child);
      finish(() => reject(new Error(`backpass 시간 초과 (${Math.round(opts.timeoutMs / 60000)}분)`)));
    }, opts.timeoutMs);
    const onAbort = () => {
      killProcessTree(child);
      finish(() => reject(new Error("backpass 취소됨")));
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      const last = tailLines(d.toString(), 1);
      if (last) opts.onLine?.(last.slice(0, 200));
    });
    child.on("error", (e) => finish(() => reject(e)));
    child.on("close", (code) => finish(() => resolve({ code, stdout, stderrTail: tailLines(stderr, 8) })));
  });
}

// ── backpass 상태 파일 모양 ─────────────────────────────

export interface BackpassHunk {
  id: string;
  find: string;
  replace: string;
  oldStart?: number;
  oldEnd?: number;
  removed?: number;
  added?: number;
}

export interface BackpassEvidence {
  polarity: "positive" | "negative" | "neutral";
  text: string;
  source: string;
}

export interface BackpassEdit {
  id: string;
  kind: "add" | "remove" | "rewrite" | "extract";
  file: string;
  title: string;
  rationale: string;
  instructions: string[];
  evidence: BackpassEvidence[];
  transcripts: number;
  skill: { path: string; name?: string; description?: string; body?: string } | null;
  hunks: BackpassHunk[];
  targetsMemoryFile?: boolean;
  applicable?: boolean;
  deltaTokens?: number;
}

export interface BackpassProposal {
  version: number;
  generatedAt: string;
  memoryFile: { path: string; hash: string; tokens: number };
  budget: { capTokens: number; current: number; projected: number; mode?: string };
  stats: { transcripts: number; positive: number; negative: number; gapClusters: number };
  edits: BackpassEdit[];
  notes?: string[];
  violations?: string[];
}

export interface SummaryQuote {
  polarity?: "positive" | "negative";
  text: string;
  effect?: string;
  moment?: string;
  source: string;
}

export interface SummaryInstruction {
  instruction: string;
  positive: number;
  negative: number;
  sessions: number;
  relevance: number;
  tokens: number | null;
  section: string | null;
  known?: boolean;
  quotes: SummaryQuote[];
}

export interface EvidenceSummary {
  generatedAt: string;
  analyzedSessions: number;
  totals: { positive: number; negative: number; gapClusters: number };
  instructions: SummaryInstruction[];
  gaps: { proposedInstruction: string; sessions: number; quotes: { text: string; effect?: string; source: string }[] }[];
}

export async function readProposal(id: string): Promise<BackpassProposal | null> {
  const p = await readJsonFile<BackpassProposal>(learningPaths(id).proposal);
  return p && Array.isArray(p.edits) ? p : null;
}

export async function readEvidenceSummary(id: string): Promise<EvidenceSummary | null> {
  const s = await readJsonFile<EvidenceSummary>(learningPaths(id).summary);
  return s && Array.isArray(s.instructions) ? s : null;
}

// ── 거절 기억 (backpass state.js 와 같은 열쇠·모양) ─────────────

export interface Rejections {
  version: 1;
  entries: Record<string, { kind: string; file: string; title: string; transcripts: number; rejectedAt: string; reason?: string }>;
}

/** backpass rejectionKey 그대로: sha256(종류 + 파일 + 찾기/바꾸기 쌍) 앞 16자 */
export function rejectionKey(edit: Pick<BackpassEdit, "kind" | "file" | "hunks">): string {
  const body = edit.hunks.map((h) => `${h.find}\u0000${h.replace}`).join("\u0001");
  return createHash("sha256").update([edit.kind, edit.file, body].join(" "), "utf8").digest("hex").slice(0, 16);
}

export async function readRejections(id: string): Promise<Rejections> {
  const r = await readJsonFile<Rejections>(learningPaths(id).rejections);
  return r && r.version === 1 && r.entries ? r : { version: 1, entries: {} };
}

/** 거절을 backpass 저장소에 적는다 — 새 증거(더 많은 대화) 없이 같은 제안이 다시 오지 않는다. */
export async function recordRejection(id: string, edit: BackpassEdit, reason?: string): Promise<void> {
  const rejections = await readRejections(id);
  rejections.entries[rejectionKey(edit)] = {
    kind: edit.kind,
    file: edit.file,
    title: edit.title,
    transcripts: edit.transcripts || 0,
    rejectedAt: new Date().toISOString(),
    ...(reason ? { reason } : {}),
  };
  await writeJsonAtomic(learningPaths(id).rejections, rejections);
}

// ── 남의 대화 증거 치우기 ─────────────────────────────────

interface EvidenceFile {
  transcript?: { id?: string; association?: { tier?: number } };
}

interface GapLedger {
  version: 1;
  entries: Record<string, { sessions: Record<string, unknown> }>;
}

async function dropLedgerSessions(pack: string, ids: ReadonlySet<string>): Promise<void> {
  const file = path.join(pack, ".backpass", "gap-ledger.json");
  const ledger = await readJsonFile<GapLedger>(file);
  if (!ledger?.entries) return;
  for (const [key, entry] of Object.entries(ledger.entries)) {
    for (const sid of Object.keys(entry.sessions ?? {})) if (ids.has(sid)) delete entry.sessions[sid];
    if (!Object.keys(entry.sessions ?? {}).length) delete ledger.entries[key];
  }
  await writeJsonAtomic(file, ledger);
}

/**
 * --strict 는 새로 모으는 대화만 거른다. 합산은 .backpass/evidence 의 파일을 전부 읽으므로,
 * 예전에 느슨한 짝짓기(3단계: 이름만 같은 지워진 폴더)로 분석된 증거를 지우고 누적 장부에서도 뺀다.
 */
async function evidenceNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
}

/** 3단계(느슨한) 짝짓기로 붙은 대화의 증거면 그 대화 id, 아니면 null */
function foreignTranscriptId(ev: EvidenceFile | null): string | null {
  const t = ev?.transcript;
  return (t?.association?.tier ?? 1) > 2 ? (t?.id ?? "") : null;
}

export async function pruneForeignEvidence(id: string): Promise<number> {
  const pack = packDir(id);
  const dir = path.join(pack, ".backpass", "evidence");
  const dropped = new Set<string>();
  for (const name of await evidenceNames(dir)) {
    const foreign = foreignTranscriptId(await readJsonFile<EvidenceFile>(path.join(dir, name)));
    if (foreign === null) continue;
    await unlink(path.join(dir, name)).catch(() => undefined);
    if (foreign) dropped.add(foreign);
  }
  if (dropped.size) await dropLedgerSessions(pack, dropped);
  return dropped.size;
}
