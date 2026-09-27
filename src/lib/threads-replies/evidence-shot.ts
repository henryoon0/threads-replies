// 스레드 답글 근거의 원문 형광 캡처 (픽 6, 09-27).
//
// 근거가 X 게시물·웹 글처럼 원본 주소가 있을 때만 찍는다 (원글 원본·수집한 원문·웹·붙인 링크). henry 노트(수집노트·강의 자료·
// FAQ·지난 글·내 경험)는 원문 화면이 아니라서 찍지 않는다.
// 실제 캡처는 scripts/shoot-quote.mjs 가 한다 (크로미움을 띄우므로 detached 스폰 + 그룹 kill).
// 캡처 실패는 던지지 않고 null — 답글 보내기를 막을 이유가 아니다.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { killProcessTree } from "@/lib/cli-bin";
import type { AnswerSource, EvidenceShot, SourceKind } from "./model";
import { envMs, evidenceReplyDir } from "./storage";

const SCRIPT = "scripts/shoot-quote.mjs";
/** X 는 로그인 프로필 락 대기 + 페이지 로드가 있어 여유를 둔다 (실측 X 21~80초(락 대기 포함) · 웹 9~12초). */
const DEFAULT_TIMEOUT_MS = 150_000;

const SHOOTABLE: ReadonlySet<SourceKind> = new Set<SourceKind>(["원글 원본", "수집한 원문", "웹", "붙인 링크"]);

/** 원문 화면으로 찍을 수 있는 근거인가 (원본 주소 + 인용). */
export function isShootable(source: AnswerSource): boolean {
  if (!SHOOTABLE.has(source.kind)) return false;
  if (!source.quote?.trim()) return false;
  try {
    const u = new URL(source.url ?? "");
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

interface ShotScriptResult {
  ok: boolean;
  png?: string;
  painted?: number;
  width?: number;
  height?: number;
  error?: string;
}

/** stdout 마지막 JSON 줄을 읽는다 (스크립트 로그는 stderr 로 간다). */
export function parseShotOutput(stdout: string): ShotScriptResult | null {
  const lines = stdout.trim().split("\n").reverse();
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(t) as ShotScriptResult;
      if (typeof parsed.ok === "boolean") return parsed;
    } catch {
      // 다음 줄
    }
  }
  return null;
}

function runShotScript(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), SCRIPT), ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true, // 스크립트 밑의 크로미움까지 그룹째 죽이려고
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}\n${e.message}`, timedOut });
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut });
    });
  });
}

function fileNameFor(source: AnswerSource): string {
  const safeId = source.id.replace(/[^A-Za-z0-9_-]/g, "") || "s";
  const hash = createHash("sha1").update(`${source.url}\n${source.quote}`).digest("hex").slice(0, 10);
  return `${safeId}-${hash}.png`;
}

/** 캡처 실패 이유. 스크립트가 준 error, 없으면 stderr 마지막 두 줄 */
function failureReason(result: ReturnType<typeof parseShotOutput>, stderr: string): string {
  return result?.error ?? (stderr.trim().split("\n").slice(-2).join(" / ") || "출력 없음");
}

/**
 * 근거 한 건의 원문 형광 캡처. 찍을 수 없는 근거이거나 실패하면 null (이유는 console.warn).
 * PNG 는 public/threads-evidence/<replyId>/ 에 쓰고, 저장(원장 반영)은 호출하는 쪽이 한다.
 */
export async function captureEvidence(replyId: string, source: AnswerSource): Promise<EvidenceShot | null> {
  if (!isShootable(source)) return null;
  const dir = evidenceReplyDir(replyId);
  const dirName = path.basename(dir);
  if (!dirName) return null;
  const file = fileNameFor(source);
  const out = path.join(dir, file);
  const timeoutMs = envMs("THREADS_EVIDENCE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);

  const { stdout, stderr, timedOut } = await runShotScript(
    [source.url as string, "--quote", source.quote, "--out", out],
    timeoutMs
  );
  if (timedOut) {
    console.warn(`[threads-evidence] ${replyId}/${source.id} 시간 초과(${Math.round(timeoutMs / 1000)}초)`);
    return null;
  }
  const result = parseShotOutput(stdout);
  if (!result?.ok || !result.png) {
    console.warn(`[threads-evidence] ${replyId}/${source.id} 캡처 실패: ${failureReason(result, stderr)}`);
    return null;
  }
  return {
    sourceId: source.id,
    url: source.url as string,
    image: `/threads-evidence/${dirName}/${file}`,
    painted: result.painted ?? 0,
    createdAt: new Date().toISOString(),
  };
}
