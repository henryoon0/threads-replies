// 계정 주인 소개 — 초안 지시문의 첫 줄에 들어간다. 연결할 때 아이디가 채워지고,
// 한 줄 소개는 연결 화면에서 받는다 (예: "AI 실무 교육가", "성수동 카페 사장").
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface OwnerProfile {
  username: string;
  intro: string;
}

export function profilePath(): string {
  return path.join(process.env.THREADS_REPLIES_DATA ?? path.join(process.cwd(), "data"), "profile.json");
}

export async function readProfile(): Promise<OwnerProfile> {
  try {
    const p = JSON.parse(await readFile(profilePath(), "utf8")) as Partial<OwnerProfile>;
    return { username: p.username ?? "", intro: p.intro ?? "" };
  } catch {
    return { username: "", intro: "" };
  }
}

export async function writeProfile(patch: Partial<OwnerProfile>): Promise<OwnerProfile> {
  const next = { ...(await readProfile()), ...patch };
  await mkdir(path.dirname(profilePath()), { recursive: true });
  await writeFile(profilePath(), JSON.stringify(next, null, 2));
  return next;
}

/** 지시문용 한 줄: "스레드 @handle(소개)" */
export function ownerLine(p: OwnerProfile): string {
  const handle = p.username ? `스레드 @${p.username}` : "스레드 계정";
  return p.intro.trim() ? `${handle}(${p.intro.trim()})` : handle;
}
