// 잠깐만 공개하는 미디어 — 외부 서비스(스레드 등)가 이미지를 가져갈 동안만 Cloudflare Pages 에 둔다.
//
// Pages 는 배포마다 그 시점 사이트 전체를 따로 보관하고 고유 주소(https://<id8>.<project>.pages.dev)로
// 계속 열어 둔다. 그래서 파일만 지우고 다시 배포하면 대표 주소에서만 사라지고 옛 배포 주소로는 남는다.
// 끝까지 지우려면: ① 파일 삭제 → ② 재배포(대표 주소에서 사라짐) → ③ 그 파일이 든 배포 삭제.
// 중간에 실패한 건은 대기 목록(ephemeral-pending.json)에 남겨 다음 업로드·정리 때 다시 지운다.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { deployShareSite } from "./deploy";
import { shareBaseUrl, shareProjectName, shareRootDir, shareSiteDir } from "./paths";

const execFileAsync = promisify(execFile);

/** 사이트 안 임시 미디어 폴더. _headers 에서 캐시 예외를 둔다(외부 fetcher 가 no-store 를 거부). */
export const EPHEMERAL_DIR = "tmp-media";

export interface EphemeralMedia {
  /** 외부 서비스에 넘길 공개 주소 */
  readonly url: string;
  /** 사이트 안 상대 경로 (tmp-media/xxx.jpg) */
  readonly key: string;
  /** 이 파일이 처음 실린 배포의 id 앞 8글자 — 나중에 그 배포를 지운다 */
  readonly deploymentPrefix?: string;
}

interface PendingCleanup {
  key: string;
  deploymentPrefix?: string;
  at: string;
}

function pendingPath(): string {
  return path.join(shareRootDir(), "ephemeral-pending.json");
}

async function readPending(): Promise<PendingCleanup[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(pendingPath(), "utf8")) as { items?: PendingCleanup[] };
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

async function writePending(items: PendingCleanup[]): Promise<void> {
  await fs.mkdir(path.dirname(pendingPath()), { recursive: true });
  await fs.writeFile(pendingPath(), JSON.stringify({ items }, null, 2));
}

/** 이미지를 올리고 공개 주소를 돌려준다. 다 쓰면 반드시 removeEphemeralMedia 를 부른다. */
export async function uploadEphemeralMedia(buffer: Buffer, ext: "jpg" | "png"): Promise<EphemeralMedia> {
  const key = `${EPHEMERAL_DIR}/${randomBytes(12).toString("hex")}.${ext}`;
  const filePath = path.join(shareSiteDir(), key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
  // 올리자마자 정리 대기 목록에 적는다 — 발행 도중 서버가 죽어도 다음에 지워진다.
  const pending = await readPending();
  await writePending([...pending, { key, at: new Date().toISOString() }]);
  try {
    const deploy = await deployShareSite();
    const deploymentPrefix = deploymentPrefixOf(deploy.deploymentUrl);
    await writePending((await readPending()).map((p) => (p.key === key ? { ...p, deploymentPrefix } : p)));
    return { url: `${deploy.deploymentUrl ?? shareBaseUrl()}/${key}`, key, deploymentPrefix };
  } catch (e) {
    await removeEphemeralMedia({ url: "", key }).catch(() => {});
    throw e;
  }
}

export function deploymentPrefixOf(deploymentUrl: string | undefined): string | undefined {
  return deploymentUrl?.match(/^https:\/\/([a-z0-9]+)\./i)?.[1];
}

/**
 * 파일을 지우고 재배포한 뒤, 이번 것을 포함해 대기 목록의 옛 배포를 전부 지운다.
 * 실패해도 throw 하지 않는다 — 답글 발행은 이미 끝났고, 남은 건 다음 번에 다시 지운다.
 */
export async function removeEphemeralMedia(media: EphemeralMedia): Promise<{ ok: boolean; error?: string }> {
  try {
    await fs.rm(path.join(shareSiteDir(), media.key), { force: true });
    const pending = await readPending();
    // 사이트 폴더에 남은 임시 파일(이전 실패분)도 같이 치운다
    for (const p of pending) await fs.rm(path.join(shareSiteDir(), p.key), { force: true });
    await deployShareSite(); // 대표 주소에서 사라진다
    const left: PendingCleanup[] = [];
    for (const p of pending) {
      if (p.deploymentPrefix && !(await deleteDeployment(p.deploymentPrefix))) left.push(p);
    }
    await writePending(left);
    return left.length ? { ok: false, error: `옛 배포 ${left.length}개를 아직 못 지웠어요` } : { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn(`[share] 임시 미디어 정리 실패 — 다음에 다시 지운다: ${error}`);
    return { ok: false, error };
  }
}

async function wrangler(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(process.env.WRANGLER_BIN || "wrangler", args, {
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, CI: "1" },
  });
  return String(stdout);
}

/**
 * id 앞 8글자로 배포를 찾아 지운다. 목록에 없으면 이미 지운 것으로 친다.
 * ⚠ wrangler 는 삭제 전에 "정말 지울까요?"를 묻고, 대답할 수 없는 환경에선 기본값 "아니오"로
 *   조용히 끝난다(2026-09-27 실측: 종료 코드 0 인데 안 지워짐). 질문을 건너뛰는 옵션은 --force 뿐이다.
 * ⚠ --force 는 지금 대표 주소에 걸린 배포도 지운다. 목록 맨 앞(최신 = 대표)은 절대 지우지 않는다.
 */
async function deleteDeployment(prefix: string): Promise<boolean> {
  try {
    const list = JSON.parse(
      await wrangler(["pages", "deployment", "list", "--project-name", shareProjectName(), "--json"])
    ) as { Id?: string }[];
    const at = list.findIndex((d) => d.Id?.startsWith(prefix));
    if (at < 0) return true;
    if (at === 0) return false; // 대표 배포 — 다음 배포가 생긴 뒤 지운다
    const id = list[at].Id!;
    const out = await wrangler(["pages", "deployment", "delete", id, "--project-name", shareProjectName(), "--force"]);
    return /Successfully deleted/i.test(out);
  } catch (e) {
    console.warn(`[share] 배포 ${prefix} 삭제 실패: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}
