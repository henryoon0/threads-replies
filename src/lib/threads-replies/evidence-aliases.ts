// 색인 한 장의 별칭 — 생성과 캐시 (I/O, 2026-09-27).
//
// 별칭은 "댓글 쓰는 사람이 이 자료를 부를 법한 말"이다. 09-24 실험에서 별칭이 R@5 를
// 0.54→0.83 으로 올렸다. 문서 내용 해시로 data/threads-replies/index-cache.json 에 캐시하고,
// 바뀌거나 새로 생긴 문서만 만든다 (증분). 한 번에 다 못 만들면 만든 만큼 저장한다.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { runClaudeCLI } from "@/lib/ai/claude-cli";
import { parseJsonObject } from "@/lib/ai/json";
import {
  aliasSeedText,
  cleanAliases,
  docContentHash,
  docsMissingAliases,
  emptyAliasCache,
  pruneAliasCache,
  type AliasCache,
  type EvidenceDoc,
} from "./evidence-index";
import { envMs, threadsRepliesDir } from "./storage";

const ALIAS_MODEL = process.env.THREADS_REPLIES_ALIAS_MODEL || "claude-haiku-4-5";
const BATCH = 25;
const PARALLEL = 3;

export function aliasCachePath(): string {
  return process.env.THREADS_REPLIES_INDEX_CACHE ?? path.join(threadsRepliesDir(), "index-cache.json");
}

export async function readAliasCache(): Promise<AliasCache> {
  try {
    const parsed = JSON.parse(await readFile(aliasCachePath(), "utf-8")) as AliasCache;
    return parsed && parsed.version === 1 && parsed.entries ? parsed : emptyAliasCache();
  } catch {
    return emptyAliasCache();
  }
}

async function writeAliasCache(cache: AliasCache): Promise<void> {
  const file = aliasCachePath();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  await writeFile(tmp, JSON.stringify(cache), "utf-8");
  await rename(tmp, file);
}

export function buildAliasPrompt(docs: readonly EvidenceDoc[]): string {
  const rows = docs.map((d, i) => `d${i + 1} [${d.kind}] ${aliasSeedText(d)}`).join("\n");
  return `스레드 댓글에 달린 질문으로 이 자료들을 찾아야 합니다. 자료마다, 댓글 쓰는 사람이 이 자료의 내용을 물을 때 쓸 법한 말을 6~10개 적어 주세요.

좋은 별칭:
- 제품·모델·사람 이름의 다른 표기 (Claude Code → 클로드 코드, 클코 / GPT-6 Astra → 아스트라 / @rileybrown → Riley Brown)
- 한국어·영어 둘 다 (computer use → 컴퓨터 유즈, 화면 조작)
- 이 자료로 답할 수 있는 짧은 질문 ("API 없이도 되나요", "무료인가요", "요금제 차이")
- 핵심 개념어 (프롬프트 캐시, effort 조절, 로컬 실행)

한 별칭은 2~20자. 제목을 그대로 반복하지 마세요.

자료:
${rows}

JSON 하나만 답하세요. 키는 자료 번호입니다.
{"d1": ["별칭", "..."], "d2": ["..."]}`;
}

async function aliasBatch(docs: EvidenceDoc[], timeoutMs: number, signal?: AbortSignal): Promise<Record<string, string[]>> {
  const raw = await runClaudeCLI(buildAliasPrompt(docs), {
    model: ALIAS_MODEL,
    effort: "low",
    timeoutMs,
    requireClaude: true,
    signal,
    tmpPrefix: "threads-alias-",
  });
  const parsed = parseJsonObject<Record<string, unknown>>(raw);
  const out: Record<string, string[]> = {};
  docs.forEach((d, i) => {
    const aliases = cleanAliases(parsed[`d${i + 1}`], d.title);
    if (aliases.length) out[docContentHash(d)] = aliases;
  });
  return out;
}

export interface AliasFillResult {
  cache: AliasCache;
  generated: number;
  missing: number;
  errors: string[];
}

/**
 * 캐시에 없는 문서의 별칭을 만든다. `limit` 개까지만 (검색 도중엔 작게, 예열 스크립트는 전부).
 * 배치 하나가 실패해도 나머지는 저장한다.
 */
export async function fillAliases(
  docs: readonly EvidenceDoc[],
  opts: { limit?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}
): Promise<AliasFillResult> {
  let cache = await readAliasCache();
  const missingAll = docsMissingAliases(docs, cache);
  const todo = missingAll.slice(0, opts.limit ?? missingAll.length);
  const batches: EvidenceDoc[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  const timeoutMs = envMs("THREADS_REPLIES_ALIAS_TIMEOUT_MS", 150_000);
  const errors: string[] = [];
  let generated = 0;
  let next = 0;
  const worker = async () => {
    while (next < batches.length && !opts.signal?.aborted) {
      const batch = batches[next++];
      try {
        const got = await aliasBatch(batch, timeoutMs, opts.signal);
        // 최신 파일 위에 합친다 (동시에 도는 다른 채우기와 덮어쓰기 경쟁 방지)
        const fresh = await readAliasCache();
        const at = new Date().toISOString();
        for (const [h, aliases] of Object.entries(got)) fresh.entries[h] = { aliases, at };
        cache = fresh;
        await writeAliasCache(cache);
        generated += Object.keys(got).length;
        opts.onProgress?.(generated, todo.length);
      } catch (e) {
        errors.push(e instanceof Error ? e.message.slice(0, 200) : String(e));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker));
  if (todo.length === missingAll.length && errors.length === 0) {
    cache = pruneAliasCache(await readAliasCache(), docs);
    await writeAliasCache(cache);
  }
  return { cache, generated, missing: missingAll.length - generated, errors };
}

// 검색 도중 별칭이 많이 비었으면 기다리지 않고 뒤에서 채운다. 핫 리로드에도 하나만 돌게 globalThis 에 둔다.
const g = globalThis as { __threadsAliasWarm?: Promise<unknown> | null };

export function warmAliasesInBackground(docs: readonly EvidenceDoc[]): boolean {
  if (g.__threadsAliasWarm) return false;
  g.__threadsAliasWarm = fillAliases(docs)
    .catch(() => null)
    .finally(() => {
      g.__threadsAliasWarm = null;
    });
  return true;
}
