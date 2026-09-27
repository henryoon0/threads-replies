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

export interface Capabilities {
  ai: { claude: boolean; codex: boolean };
  capture: boolean;
  imageAttach: boolean;
}

function hasCli(name: string): boolean {
  return path.isAbsolute(resolveCliBin(name));
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
    ai: { claude: hasCli("claude"), codex: hasCli("codex") },
    capture: hasPlaywrightBrowser(),
    imageAttach: await cloudflareReady(),
  };
}
