import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * 공유 허브 저장 경로 — repo-local data/share/ 아래에 모두 모은다.
 * site/ 가 Cloudflare Pages 에 통째로 올라가는 정적 사이트 루트라서,
 * 발행한 항목이 누적되고 한 번 나간 링크는 다음 배포에도 살아남는다.
 */
export function shareRootDir(): string {
  return process.env.SHARE_DATA_DIR || path.join(process.cwd(), "data", "share");
}

/** Cloudflare Pages 에 배포되는 정적 사이트 루트. */
export function shareSiteDir(): string {
  return path.join(shareRootDir(), "site");
}

export function shareManifestPath(): string {
  return path.join(shareRootDir(), "manifest.json");
}

/**
 * Cloudflare Pages 프로젝트명 — *.pages.dev 서브도메인이 된다. 전 세계에서 겹치면 안 돼서
 * 처음 한 번 무작위로 정해 data/share/project.txt 에 기억한다. 프로젝트는 첫 배포 때 만든다(deploy.ts).
 */
export function shareProjectName(): string {
  if (process.env.SHARE_CF_PROJECT) return process.env.SHARE_CF_PROJECT;
  const file = path.join(shareRootDir(), "project.txt");
  try {
    const saved = readFileSync(file, "utf8").trim();
    if (saved) return saved;
  } catch {
    // 처음
  }
  const name = `threads-img-${randomBytes(4).toString("hex")}`;
  mkdirSync(shareRootDir(), { recursive: true });
  writeFileSync(file, name);
  return name;
}

/** 발행된 항목의 공개 베이스 URL. */
export function shareBaseUrl(): string {
  return process.env.SHARE_BASE_URL || `https://${shareProjectName()}.pages.dev`;
}
