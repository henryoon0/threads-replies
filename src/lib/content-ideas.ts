import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeIdea, type ContentIdea } from "@/lib/content-ideas-model";
import { formatThreadPostParagraphs } from "@/lib/threads-link-text";
import { readJsonCachedAt, writeJsonAt } from "@/lib/json-store";

// Store for generated content ideas. Each new/updated idea has an independent
// atomic record under data/content-ideas-records; data/content-ideas.json remains
// the compatibility projection for older scripts and pre-migration ideas.

function ideasPath(): string {
  return (
    process.env.CONTENT_IDEAS_PATH ||
    path.join(process.cwd(), "data", "content-ideas.json")
  );
}

function ideaRecordsDir(): string {
  return (
    process.env.CONTENT_IDEAS_RECORDS_DIR ||
    path.join(path.dirname(ideasPath()), "content-ideas-records")
  );
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

type ContentIdeasWriteGuard = typeof globalThis & {
  __contentIdeasWriteQueue?: Promise<void>;
};

function withIdeasWriteLock<T>(mutation: () => Promise<T>): Promise<T> {
  const guard = globalThis as ContentIdeasWriteGuard;
  const run = (guard.__contentIdeasWriteQueue ?? Promise.resolve()).then(
    mutation,
    mutation
  );
  guard.__contentIdeasWriteQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function fileList(): Promise<ContentIdea[]> {
  // mtime 캐시: 6.7MB 파일을 호출처 15곳이 요청마다 재파싱하던 경로.
  // 안 바뀌었으면 stat 1번 + 클론으로 끝난다 (readJsonCachedAt 이 클론을 보장).
  // strict: a missing file → [], but corrupt JSON surfaces rather than reads as empty.
  const parsed = await readJsonCachedAt<unknown>(ideasPath(), null, { strict: true });
  return Array.isArray(parsed) ? parsed.map(normalizeIdea) : [];
}

async function fileSaveAll(ideas: ContentIdea[]): Promise<void> {
  await writeJsonAt(ideasPath(), ideas);
}

/**
 * 보드가 바뀌었는지만 알려주는 싸구려 도장 (파싱 없이 stat 1번).
 * 목록 응답은 수 MB라 폴링할 수 없다 — 화면은 이 값이 달라졌을 때만 목록을
 * 다시 받는다. mtime 만 쓰면 같은 밀리초 안의 두 번째 쓰기를 놓치므로
 * (updatedAt 을 캐시 키로 쓰다 겪은 함정) size 를 같이 섞는다.
 */
export async function ideasVersion(): Promise<string> {
  const stat = await fs.stat(ideasPath()).catch(() => null);
  return stat ? `${Math.round(stat.mtimeMs)}-${stat.size}` : "0-0";
}

function ideaRecordPath(id: string): string {
  return path.join(ideaRecordsDir(), `${encodeURIComponent(id)}.json`);
}

async function fileRecords(): Promise<ContentIdea[]> {
  let names: string[];
  try {
    names = await fs.readdir(ideaRecordsDir());
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
  return Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) =>
        normalizeIdea(JSON.parse(await fs.readFile(path.join(ideaRecordsDir(), name), "utf-8")))
      )
  );
}

async function writeIdeaRecord(idea: ContentIdea): Promise<void> {
  const target = ideaRecordPath(idea.id);
  await fs.mkdir(ideaRecordsDir(), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`;
  await fs.writeFile(temp, JSON.stringify(idea, null, 2), "utf-8");
  await fs.rename(temp, target);
}

export async function listIdeas(): Promise<ContentIdea[]> {
  const [legacy, records] = await Promise.all([fileList(), fileRecords()]);
  const recordsById = new Map(records.map((idea) => [idea.id, idea]));
  const merged = legacy.map((idea) => recordsById.get(idea.id) ?? idea);
  const legacyIds = new Set(legacy.map((idea) => idea.id));
  const recovered = records
    .filter((idea) => !legacyIds.has(idea.id))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return [...recovered, ...merged];
}

/** A single-card action should not read every card and its revision history. */
export async function findIdea(id: string): Promise<ContentIdea | null> {
  try {
    return normalizeIdea(JSON.parse(await fs.readFile(ideaRecordPath(id), "utf-8")));
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    return (await fileList()).find((idea) => idea.id === id) ?? null;
  }
}

// Prepend a freshly-generated batch so the newest ideas sort first.
// ⚠저장 관문에서 문단 형식(1~2문장마다 빈 줄)을 강제한다 (henry 확정 08-11:
// 생성 경로마다 형식화를 끼우는 방식은 새 경로가 생길 때마다 빼먹는다 — 실측:
// 3안 시안이 통짜 문단으로 게시됨). 모든 생성기는 여기를 지나므로 어떤 경로도
// 형식 없는 칸을 만들 수 없다. 리스트 줄·기존 빈 줄은 형식화가 보존한다.
export async function addIdeas(ideas: ContentIdea[]): Promise<void> {
  const formatted = ideas.map((idea) => ({
    ...idea,
    posts: idea.posts.map((p) => formatThreadPostParagraphs(p)),
  }));
  // Each result is durable before the legacy array projection changes. Distinct
  // files cannot overwrite each other when independent generator processes
  // finish together; listIdeas merges these records back if a stale projection
  // writer later wins the array rename race.
  await Promise.all(formatted.map(writeIdeaRecord));
  await withIdeasWriteLock(async () => {
    const all = await fileList();
    all.unshift(...formatted);
    await fileSaveAll(all);
  });
}

export async function updateIdea(
  id: string,
  patch: Partial<ContentIdea>
): Promise<ContentIdea | null> {
  const current = (await listIdeas()).find((idea) => idea.id === id);
  if (!current) return null;
  const updated = { ...current, ...patch, id };
  await writeIdeaRecord(updated);
  return withIdeasWriteLock(async () => {
    const all = await fileList();
    const idx = all.findIndex((i) => i.id === id);
    if (idx === -1) all.unshift(updated);
    else all[idx] = updated;
    await fileSaveAll(all);
    return updated;
  });
}

export async function deleteIdea(id: string): Promise<void> {
  await fs.unlink(ideaRecordPath(id)).catch((error: unknown) => {
    if (!isMissingFileError(error)) throw error;
  });
  await withIdeasWriteLock(async () => {
    const all = await fileList();
    await fileSaveAll(all.filter((i) => i.id !== id));
  });
  // Drop the idea's attached images too so disk doesn't grow unbounded.
  await deleteMediaDir(id);
}

// ── Attached images ──────────────────────────────────────────────────────────
// Real pasted images live as files under public/content-media/<id>/ so the
// dashboard serves them statically and the JSON only stores their URLs. The dir
// is gitignored; it's created on demand.

const MEDIA_URL_PREFIX = "/content-media";

function mediaRoot(): string {
  return path.join(process.cwd(), "public", "content-media");
}

// Strip anything that isn't a safe id segment so an id can't escape the root.
function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "");
}

// Write one attached image and return its public URL. `ext` is a bare
// extension ("png", "jpg", ...). The filename is prefixed with the post index
// so it's easy to see which 칸 an orphan belongs to.
export async function saveMedia(
  id: string,
  postIndex: number,
  buffer: Buffer,
  ext: string
): Promise<string> {
  const safeId = safeSegment(id);
  if (!safeId) throw new Error("잘못된 id");
  const dir = path.join(mediaRoot(), safeId);
  await fs.mkdir(dir, { recursive: true });
  const rand = Math.random().toString(36).slice(2, 9);
  const name = `${Math.max(0, postIndex | 0)}-${Date.now().toString(36)}${rand}.${ext}`;
  await fs.writeFile(path.join(dir, name), buffer);
  return `${MEDIA_URL_PREFIX}/${safeId}/${name}`;
}

export async function copyMedia(
  id: string,
  postIndex: number,
  sourcePath: string,
  ext: string
): Promise<string> {
  const safeId = safeSegment(id);
  if (!safeId) throw new Error("잘못된 id");
  const dir = path.join(mediaRoot(), safeId);
  await fs.mkdir(dir, { recursive: true });
  const name = `${Math.max(0, postIndex | 0)}-${Date.now().toString(36)}.${ext}`;
  await fs.copyFile(sourcePath, path.join(dir, name));
  return `${MEDIA_URL_PREFIX}/${safeId}/${name}`;
}

// Best-effort delete of one attached image by its public URL. Resolves the path
// and refuses anything that lands outside the media root.
export async function deleteMediaFile(url: string): Promise<void> {
  if (!url.startsWith(`${MEDIA_URL_PREFIX}/`)) return;
  const rel = url.slice(MEDIA_URL_PREFIX.length + 1);
  const target = path.resolve(mediaRoot(), rel);
  if (target !== mediaRoot() && !target.startsWith(mediaRoot() + path.sep)) return;
  try {
    await fs.unlink(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

// Remove an idea's whole media folder (called when the idea is deleted).
export async function deleteMediaDir(id: string): Promise<void> {
  const safeId = safeSegment(id);
  if (!safeId) return;
  try {
    await fs.rm(path.join(mediaRoot(), safeId), { recursive: true, force: true });
  } catch {
    // Best effort — a missing folder is fine.
  }
}
