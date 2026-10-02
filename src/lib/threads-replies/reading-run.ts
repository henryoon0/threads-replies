// 댓글 읽기 실행 — 모델 호출(reasoning 티어) · 프로필 필요 판정 · 캐시 (순수 조립은 reading.ts).
//
// 댓글당 한 번: 결과를 팩 private/readings/<열쇠>.json 에 둔다. 열쇠 = 읽기 판 + 원글 + 댓글 + 대화 + 안전 규칙 + 실은 예시.
// 미리 쓰기(compose-variants)가 6벌을 쓰는 동안 같은 댓글을 여러 번 읽지 않게, 도는 중인 읽기는 한 Promise 를 나눠 쓴다.
// 읽기가 "누구인지 몰라서 판단이 달라진다"(needProfile)고 하면 그때만 공개 프로필을 가져와 한 번 더 읽는다.
// 읽기가 실패하면 null — 초안은 읽기 없이 예전처럼 쓴다 (읽기 때문에 초안이 막히지 않게).
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateText } from "@/lib/ai/generate";
import { parseJsonObject } from "@/lib/ai/json";
import type { PersonaConfig } from "@/lib/personas/model";
import { commenterProfile, type CommenterProfile } from "./commenter-profile";
import { buildReadingPrompt, parseReading, READING_VERSION, type CommentReading, type ReadingExample } from "./reading";
import { parseReadingBank, pickReadingExamples } from "./reading-bank";
import { envMs } from "./storage";

const DEFAULT_READING_TIMEOUT_MS = 150_000;

export interface ReadingInput {
  post: string;
  comment: string;
  commenter: string;
  conversation?: string;
  safety: string;
  ownerLine: string;
  /** 예시에서 뺄 쌍 (평가 시험 쌍) */
  exclude?: ReadonlySet<string>;
}

export interface ReadingOutcome {
  reading: CommentReading;
  examples: ReadingExample[];
  profile: CommenterProfile | null;
}

export async function readReadingBank(dir: string): Promise<ReadingExample[]> {
  try {
    return parseReadingBank(JSON.parse(await readFile(path.join(dir, "reading-examples.json"), "utf8")));
  } catch {
    return [];
  }
}

function keyOf(input: ReadingInput, examples: readonly ReadingExample[]): string {
  const parts = [READING_VERSION, input.post, input.comment, input.commenter, input.conversation ?? "", input.safety, examples.map((e) => e.pairId).join(",")];
  return createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 20);
}

async function readCache(file: string): Promise<ReadingOutcome | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as ReadingOutcome;
  } catch {
    return null;
  }
}

async function ask(persona: PersonaConfig, input: ReadingInput, examples: readonly ReadingExample[], profile: CommenterProfile | null): Promise<CommentReading | null> {
  const prompt = buildReadingPrompt({ owner: persona.ownerName, ownerLine: input.ownerLine, post: input.post, conversation: input.conversation, comment: input.comment, commenter: input.commenter, profile, safety: input.safety, examples });
  const text = await generateText({ tier: "reasoning", prompt, json: true, noTools: true, timeoutMs: envMs("THREADS_READING_TIMEOUT_MS", DEFAULT_READING_TIMEOUT_MS) });
  return parseReading(parseJsonObject(text));
}

async function readOnce(persona: PersonaConfig, packDir: string, privateDir: string, input: ReadingInput): Promise<ReadingOutcome | null> {
  const examples = pickReadingExamples(await readReadingBank(packDir), { comment: input.comment, exclude: input.exclude });
  const file = path.join(privateDir, "readings", `${keyOf(input, examples)}.json`);
  const hit = await readCache(file);
  if (hit) return hit;
  let reading = await ask(persona, input, examples, null);
  if (!reading) return null;
  let profile: CommenterProfile | null = null;
  if (reading.needProfile) {
    profile = await commenterProfile(privateDir, input.commenter);
    if (profile) reading = (await ask(persona, input, examples, profile)) ?? reading;
  }
  const out: ReadingOutcome = { reading, examples, profile };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(out, null, 2));
  return out;
}

/** 댓글 읽기 (캐시·동시 호출 합치기). 실패하면 null — 던지지 않는다. */
export function readComment(persona: PersonaConfig, packDir: string, privateDir: string, input: ReadingInput): Promise<ReadingOutcome | null> {
  const g = globalThis as typeof globalThis & { __readingInflight?: Map<string, Promise<ReadingOutcome | null>> };
  g.__readingInflight ??= new Map();
  const key = `${privateDir}#${input.commenter}#${input.comment}`;
  const running = g.__readingInflight.get(key);
  if (running) return running;
  const run = readOnce(persona, packDir, privateDir, input)
    .catch((e) => {
      console.warn(`[reading] 읽기 실패: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    })
    .finally(() => g.__readingInflight?.delete(key));
  g.__readingInflight.set(key, run);
  return run;
}
