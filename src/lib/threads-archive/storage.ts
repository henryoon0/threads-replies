// 스레드 성과 보관함 파일 배선. 경로 계산은 전부 여기 모은다(CLAUDE.md 저장 모델).
//
//   data/threads-archive/
//     posts/<postId>.json      발행글 + 인사이트 (dirStore, 글당 1파일)
//     repurpose/<postId>.json  재활용 결과 캐시 (카톡·링크드인)
//     token.json               장기 토큰 + 만료 (0600)
//     job.json                 동기화 잡 상태
import path from "node:path";
import { dirStore, jsonStore, readJsonAt, writeJsonAt } from "@/lib/json-store";
import type { ArchivedPost, ThreadsSyncJob } from "./model";

export function threadsArchiveDir(): string {
  return (
    process.env.THREADS_ARCHIVE_DIR ??
    path.join(process.cwd(), "data", "threads-archive")
  );
}

/** 글당 1파일 — 동기화가 바뀐 글만 다시 쓰고, 한 글이 깨져도 목록이 안 죽는다. */
const posts = dirStore<ArchivedPost>({
  dir: "threads-archive/posts",
  envVar: "THREADS_ARCHIVE_POSTS_DIR",
});

export function postsDir(): string {
  return posts.dir();
}

export async function readPost(id: string): Promise<ArchivedPost | null> {
  return posts.get(id);
}

export async function listPosts(): Promise<ArchivedPost[]> {
  return posts.list();
}

export async function writePost(post: ArchivedPost): Promise<void> {
  await posts.put(post.id, post);
}

// ── 토큰 ───────────────────────────────────────────────────────────

export interface StoredThreadsToken {
  accessToken: string;
  refreshedAt: string;
  expiresAt: string;
  /** 이 토큰의 씨앗이 된 .env.local THREADS_ACCESS_TOKEN. env 에 새 토큰을
   *  붙여넣었는지 판별하는 기준 (인스타와 같은 패턴). */
  seedToken?: string;
  /** 인증 때 실제로 받은 스코프. 답글 칸을 읽을 수 있는지 판정에 쓴다. */
  scopes?: string[];
}

export function tokenPath(): string {
  return path.join(threadsArchiveDir(), "token.json");
}

export async function readStoredToken(): Promise<StoredThreadsToken | null> {
  return readJsonAt<StoredThreadsToken | null>(tokenPath(), null);
}

export async function writeStoredToken(token: StoredThreadsToken): Promise<void> {
  await writeJsonAt(tokenPath(), token, { secret: true });
}

// ── 잡 ─────────────────────────────────────────────────────────────

const jobStore = jsonStore<ThreadsSyncJob>({
  file: "job.json",
  dirEnvVar: "THREADS_ARCHIVE_DIR",
  fallback: { state: "idle", updatedAt: new Date(0).toISOString() },
});

function jobFilePath(): string {
  return path.join(threadsArchiveDir(), "job.json");
}

export async function readJob(): Promise<ThreadsSyncJob> {
  return readJsonAt<ThreadsSyncJob>(jobFilePath(), {
    state: "idle",
    updatedAt: new Date(0).toISOString(),
  });
}

/** 잡 상태 패치 — updatedAt 이 하트비트(고아 판정 기준). */
export async function patchJob(
  patch: Partial<ThreadsSyncJob>
): Promise<ThreadsSyncJob> {
  const current = await readJob();
  const next: ThreadsSyncJob = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAt(jobFilePath(), next);
  return next;
}

export { jobStore };

// ── 재활용 캐시 ────────────────────────────────────────────────────

export type RepurposeMode = "kakao" | "linkedin";

export interface RepurposeRecord {
  id: string;
  kakao?: string;
  linkedin?: string;
  updatedAt?: string;
}

const repurpose = dirStore<RepurposeRecord>({
  dir: "threads-archive/repurpose",
  envVar: "THREADS_ARCHIVE_REPURPOSE_DIR",
});

export async function readRepurpose(id: string): Promise<RepurposeRecord | null> {
  return repurpose.get(id);
}

/** 모드별 필드를 같은 파일에 누적한다(읽기-병합-쓰기). */
export async function saveRepurposeField(
  id: string,
  mode: RepurposeMode,
  value: string
): Promise<RepurposeRecord> {
  const current = (await repurpose.get(id)) ?? { id };
  const next: RepurposeRecord = {
    ...current,
    id,
    [mode]: value,
    updatedAt: new Date().toISOString(),
  };
  await repurpose.put(id, next);
  return next;
}
