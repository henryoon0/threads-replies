import { execFile } from "node:child_process";
import { accessSync, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { shareBaseUrl, shareProjectName, shareSiteDir } from "./paths";
import { recordDeploy } from "./manifest";
import { augmentedPath, resolveCliBin } from "@/lib/cli-bin";

const execFileAsync = promisify(execFile);

/** 동시 배포 직렬화 — 단일 사용자 앱이라 큐 대신 체이닝이면 충분. */
let deployChain: Promise<unknown> = Promise.resolve();

/**
 * site/ 디렉토리를 통째로 Cloudflare Pages 에 직접 업로드한다.
 * wrangler OAuth 세션(로컬 로그인)을 그대로 쓰므로 별도 토큰이 필요 없다.
 * 프로덕션 브랜치(main)로 올려 안정 URL(https://<project>.pages.dev)을 유지.
 */
export async function deployShareSite(): Promise<{ url: string; deploymentUrl?: string }> {
  const run = deployChain.then(() => deployOnce());
  // 실패해도 체인은 계속 흘러가게 — 다음 배포 시도를 막지 않는다.
  deployChain = run.catch(() => undefined);
  return run;
}

/**
 * wrangler 출력에서 이번 배포의 고유 URL(https://<hash>.<project>.pages.dev)을 뽑는다.
 * 프로덕션 별칭은 전파에 30초 넘게 걸릴 수 있지만(2026-08-07 실측: 발행이 404 로 죽음)
 * 고유 URL 은 배포 완료 즉시 열린다 — 인스타처럼 바로 가져가야 하는 소비자용.
 */
function parseDeploymentUrl(stdout: string): string | undefined {
  const re = new RegExp(`https://[a-z0-9]+\\.${shareProjectName()}\\.pages\\.dev`, "i");
  return stdout.match(re)?.[0];
}

async function deployOnce(): Promise<{ url: string; deploymentUrl?: string }> {
  const siteDir = shareSiteDir();
  await ensureRootIndex(siteDir);

  const wrangler = wranglerBin();
  const args = [
    "pages",
    "deploy",
    siteDir,
    "--project-name",
    shareProjectName(),
    "--branch",
    "main",
    "--commit-dirty=true",
  ];

  const deploy = () =>
    execFileAsync(wrangler, args, {
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PATH: augmentedPath(), CI: "1" },
    });
  try {
    let stdout: string;
    try {
      ({ stdout } = await deploy());
    } catch (e) {
      // 처음 올릴 땐 내 계정에 프로젝트가 없다 — 만들고 한 번 더
      const text = `${(e as { stderr?: unknown }).stderr ?? ""} ${(e as Error).message ?? ""}`;
      if (!PROJECT_MISSING.test(text)) throw e;
      await createProject();
      ({ stdout } = await deploy());
    }
    const url = shareBaseUrl();
    await recordDeploy({ at: new Date().toISOString(), ok: true, url });
    return { url, deploymentUrl: parseDeploymentUrl(String(stdout)) };
  } catch (e) {
    const detail =
      e && typeof e === "object" && "stderr" in e
        ? String((e as { stderr: unknown }).stderr).slice(-600)
        : e instanceof Error
          ? e.message
          : String(e);
    await recordDeploy({
      at: new Date().toISOString(),
      ok: false,
      error: detail,
    });
    throw new Error(`Cloudflare 배포 실패: ${detail}`);
  }
}

/** 앱에 같이 설치된 wrangler 를 먼저 쓴다 (받는 사람 컴퓨터엔 따로 없을 수 있다). */
export function wranglerBin(): string {
  if (process.env.WRANGLER_BIN) return process.env.WRANGLER_BIN;
  const local = path.join(process.cwd(), "node_modules", ".bin", "wrangler");
  try {
    accessSync(local);
    return local;
  } catch {
    return resolveCliBin("wrangler");
  }
}

const PROJECT_MISSING = /project not found|could not find project|8000007|does not exist/i;

/** 내 Cloudflare 계정에 이 프로젝트를 만든다 (처음 한 번). */
async function createProject(): Promise<void> {
  await execFileAsync(wranglerBin(), ["pages", "project", "create", shareProjectName(), "--production-branch", "main"], {
    timeout: 60_000,
    env: { ...process.env, PATH: augmentedPath(), CI: "1" },
  });
}

/** 루트로 들어온 사람에게는 아무 목록도 보여주지 않는다(항목 URL 직접 공유 전제). */
async function ensureRootIndex(siteDir: string): Promise<void> {
  await fs.mkdir(siteDir, { recursive: true });

  // 엣지 캐시 차단 — 기본 s-maxage가 길어서 재발행/발행취소가 최대 1주일
  // 묵살되는 실측. 페이지가 가벼운 정적 HTML 이라 매번 원본까지 와도 충분히 싸다.
  // ⚠ max-age=0, must-revalidate 로는 부족하다(2026-07-18 실측: 발행 해제 후에도
  // 엣지가 cf-cache-status: HIT, age 620 으로 옛 페이지를 계속 서빙). 저장 자체를
  // 금지하는 no-store 여야 해제·재발행이 즉시 반영된다.
  // ⚠ ig-story/* 예외는 필수 — 인스타 미디어 fetcher 가 no-store 응답을 거부해
  // 스토리 발행이 "media could not be fetched" 400 으로 죽는다 (2026-08-05 실측).
  // 파일명이 발행 시도마다 랜덤이라 캐시 신선도 문제도 없다. 인스타는 fetch 실패를
  // URL 단위로 캐시하므로, 한 번 실패한 URL 은 헤더를 고쳐도 영영 안 된다.
  // publish/* 는 같은 이유의 예외다 — 스레드 칸 이미지와 인스타 카드뉴스가 여기 산다.
  // tmp-media/* 도 같다 — 스레드 답글 이미지가 가져가질 동안만 산다(ephemeral-media.ts).
  await fs.writeFile(
    path.join(siteDir, "_headers"),
    `/*
  Cache-Control: no-store
  X-Robots-Tag: noindex
/ig-story/*
  ! Cache-Control
/publish/*
  ! Cache-Control
/tmp-media/*
  ! Cache-Control
`,
    "utf-8"
  );

  // 404.html 이 없으면 Pages 가 SPA 폴백으로 모든 미존재 경로에 루트 index 를
  // 200 으로 돌려준다 → 발행 해제한 링크가 "살아있는 것처럼" 보인다(실측).
  // 명시적 404 페이지로 폴백을 끈다.
  await fs.writeFile(
    path.join(siteDir, "404.html"),
    `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" /><title>페이지 없음</title>
<style>body{background:#f4f3ee;font-family:ui-sans-serif,-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#a3a3a3;font-size:13px}</style>
</head><body>없는 페이지예요</body></html>
`,
    "utf-8"
  );

  const file = path.join(siteDir, "index.html");
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(
      file,
      `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" /><title>threads-replies</title>
<style>body{background:#f4f3ee;font-family:ui-sans-serif,-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#a3a3a3;font-size:13px}</style>
</head><body>threads-replies</body></html>
`,
      "utf-8"
    );
  }
}
