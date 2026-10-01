// 이 컴퓨터에서 켤 수 있는 기능 — 화면이 버튼을 보일지 숨길지 정한다.
//   AI 초안: claude 또는 codex CLI (둘 다 없으면 초안 없이 직접 쓴다)
//   원문 캡처: Playwright 브라우저 (설치 스크립트가 받는다)
//   캡처를 답글에 붙이기: Cloudflare 로그인(wrangler) — 공개 주소가 있어야 스레드가 이미지를 가져간다
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { augmentedPath, resolveCliBin } from "@/lib/cli-bin";
import { wranglerBin } from "@/lib/share/deploy";

const run = promisify(execFile);

export interface CliAuth {
  installed: boolean;
  loggedIn: boolean;
}

/** ready = 초안을 쓸 수 있음, logged-out = 깔려는 있는데 로그인 안 됨, missing = 둘 다 없음 */
export type AiState = "ready" | "logged-out" | "missing";

export interface Capabilities {
  /** claude·codex = 실제로 초안을 쓸 수 있나 (깔려 있고 로그인까지 됨) */
  ai: { claude: boolean; codex: boolean; state: AiState };
  capture: boolean;
  imageAttach: boolean;
}

function hasCli(name: string): boolean {
  return path.isAbsolute(resolveCliBin(name));
}

/** `claude auth status --json` 출력 → 로그인 됐나 (2026-10-01: 깔려만 있고 로그인 안 된 맥에서 초안이 조용히 실패했다) */
export function claudeLoggedIn(stdout: string): boolean {
  try {
    return (JSON.parse(stdout) as { loggedIn?: unknown }).loggedIn === true;
  } catch {
    return false;
  }
}

/** `codex login status` 출력 → 로그인 됐나 */
export function codexLoggedIn(stdout: string): boolean {
  return /^\s*Logged in\b/im.test(stdout);
}

export function aiState(a: { claude: CliAuth; codex: CliAuth }): AiState {
  if (a.claude.loggedIn || a.codex.loggedIn) return "ready";
  return a.claude.installed || a.codex.installed ? "logged-out" : "missing";
}

let authCache: { at: number; value: { claude: CliAuth; codex: CliAuth } } | null = null;

async function probe(name: string, args: string[], ok: (out: string) => boolean): Promise<CliAuth> {
  if (!hasCli(name)) return { installed: false, loggedIn: false };
  try {
    const { stdout, stderr } = await run(resolveCliBin(name), args, { timeout: 15_000, env: { ...process.env, PATH: augmentedPath() } });
    return { installed: true, loggedIn: ok(`${stdout}\n${stderr}`) };
  } catch (e) {
    const out = e as { stdout?: string; stderr?: string };
    return { installed: true, loggedIn: ok(`${out.stdout ?? ""}\n${out.stderr ?? ""}`) };
  }
}

/** 로그인 확인은 1~3초라 "됨"은 10분, "안 됨"은 30초만 기억한다 (로그인 직후 새로고침에 바로 켜지게). */
async function aiAuth(): Promise<{ claude: CliAuth; codex: CliAuth }> {
  const ready = authCache && (authCache.value.claude.loggedIn || authCache.value.codex.loggedIn);
  if (authCache && Date.now() - authCache.at < (ready ? 10 * 60_000 : 30_000)) return authCache.value;
  const [claude, codex] = await Promise.all([
    probe("claude", ["auth", "status", "--json"], (o) => claudeLoggedIn(o.slice(o.indexOf("{"), o.lastIndexOf("}") + 1))),
    probe("codex", ["login", "status"], codexLoggedIn),
  ]);
  authCache = { at: Date.now(), value: { claude, codex } };
  return authCache.value;
}

function hasPlaywrightBrowser(): boolean {
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(homedir(), "Library", "Caches", "ms-playwright");
  try {
    return existsSync(dir) && readdirSync(dir).some((d) => d.startsWith("chromium"));
  } catch {
    return false;
  }
}

let cfCache: { at: number; ok: boolean } | null = null;

/** wrangler 가 로그인돼 있는지. whoami 는 3~5초라 "됨"은 10분, "안 됨"은 30초만 기억한다(로그인 직후 새로고침에 바로 켜지게). */
async function cloudflareReady(): Promise<boolean> {
  if (cfCache && Date.now() - cfCache.at < (cfCache.ok ? 10 * 60_000 : 30_000)) return cfCache.ok;
  let ok = false;
  try {
    const { stdout } = await run(wranglerBin(), ["whoami"], {
      timeout: 20_000,
      env: { ...process.env, PATH: augmentedPath(), CI: "1" },
    });
    ok = /associated with the email|You are logged in/i.test(String(stdout));
  } catch {
    ok = false;
  }
  cfCache = { at: Date.now(), ok };
  return ok;
}

export async function capabilities(): Promise<Capabilities> {
  return {
    ai: await aiAuth().then((a) => ({ claude: a.claude.loggedIn, codex: a.codex.loggedIn, state: aiState(a) })),
    capture: hasPlaywrightBrowser(),
    imageAttach: await cloudflareReady(),
  };
}
