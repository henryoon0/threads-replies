// 지식 행의 로컬 원천 읽기. 경로 계산은 페르소나 설정(registry)에서만 가져온다.
//
// 같은 함수가 두 곳에 쓰인다:
//  - scripts/personas/backfill-knowledge.ts → Supabase 에 올릴 행
//  - supabase.ts 의 로컬 폴백 → DB 가 없거나 끊겼을 때 메모리 검색
//
// AICC: 스레드 보관함 글(data/threads-archive/posts) + 내 답글(my-replies.json)
//       + 짝 댓글(voice-pairs.json, 원장의 myReply)
// 박약사: 긁어 모은 Q&A 쌍(glp1-pharmacy-qa-pairs.json) — persona.voicePairs 가 가리킨다.

import { readFile } from "fs/promises";
import path from "path";
import { listPosts } from "@/lib/threads-archive/storage";
import { personaDataDir, readPersona, repoPath } from "@/lib/personas/registry";
import { readRepliesLedger } from "@/lib/threads-replies/storage";
import {
  idfWeights,
  postRowsFromArchive,
  replyRowsFromMyReplies,
  replyRowsFromQaPairs,
  type MyReplyRow,
  type PostRow,
  type RawMyReply,
  type RawQaPair,
  type RawVoicePair,
} from "./rows";

/** 스레드 보관함(data/threads-archive)은 AICC 계정의 것이다. 다른 페르소나는 글 원천이 아직 없다. */
const ARCHIVE_POSTS_PERSONAS = new Set(["me"]);

export interface LocalKnowledge {
  personaId: string;
  posts: PostRow[];
  replies: MyReplyRow[];
}

async function readJsonOrNull(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function asMyReplies(raw: unknown): RawMyReply[] {
  const items = Array.isArray(raw) ? raw : (raw as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? items.filter((r): r is RawMyReply => typeof r?.id === "string" && typeof r?.text === "string") : [];
}

type VoiceItem = { q?: unknown; a?: unknown; comment?: unknown; reply?: unknown; at?: unknown };

function isQa(p: VoiceItem): p is { q: string; a: string } {
  return typeof p.q === "string" && typeof p.a === "string";
}

function isPair(p: VoiceItem): p is { comment: string; reply: string; at?: string } {
  return typeof p.comment === "string" && typeof p.reply === "string";
}

/** voice 파일은 두 모양이다: AICC [{comment, reply, at}] · 박약사 {pairs:[{q, a}]} */
function splitVoiceFile(raw: unknown): { pairs: RawVoicePair[]; qa: RawQaPair[] } {
  const list = Array.isArray(raw) ? raw : (raw as { pairs?: unknown } | null)?.pairs;
  const items: VoiceItem[] = Array.isArray(list) ? list.filter((p) => typeof p === "object" && p !== null) : [];
  return {
    pairs: items.filter(isPair).map((p) => ({ comment: p.comment, reply: p.reply, at: typeof p.at === "string" ? p.at : undefined })),
    qa: items.filter(isQa).map((p) => ({ q: p.q, a: p.a })),
  };
}

/** 원장에서 "내 답 id → 그 답이 달린 댓글 글" (작성자 아이디는 버린다). */
async function commentsFromLedger(dataDir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const ledger = await readRepliesLedger(path.join(dataDir, "ledger.json"));
    for (const r of ledger.replies) if (r.myReply?.id && r.text?.trim()) out.set(r.myReply.id, r.text.trim());
  } catch {
    // 원장이 깨졌거나 없음 — 짝 댓글 없이 간다
  }
  return out;
}

/**
 * 받은 댓글 → 그 답이 달린 스레드 주소. Q&A 파일엔 주소가 없어서 말투 짝(voice-pairs.json)에서 찾는다
 * (2026-09-30 henry "검색에서 실제 스레드 글로도 이동").
 */
async function permalinksFromVoicePairs(dataDir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const raw = (await readJsonOrNull(path.join(dataDir, "voice-pairs.json"))) as { pairs?: unknown } | unknown[] | null;
  const pairs = Array.isArray(raw) ? raw : Array.isArray(raw?.pairs) ? raw.pairs : [];
  for (const p of pairs as { comment?: unknown; permalink?: unknown }[]) {
    if (typeof p.comment === "string" && typeof p.permalink === "string" && /^https:\/\//.test(p.permalink)) out.set(p.comment.trim(), p.permalink);
  }
  return out;
}

/** 페르소나 하나의 로컬 지식 행 전부. */
export async function readLocalKnowledge(personaId: string): Promise<LocalKnowledge> {
  const persona = await readPersona(personaId);
  const dataDir = personaDataDir(persona);
  const voice = splitVoiceFile(persona.voicePairs ? await readJsonOrNull(repoPath(persona.voicePairs)) : null);

  const posts = ARCHIVE_POSTS_PERSONAS.has(persona.id) ? postRowsFromArchive(persona.id, await listPosts()) : [];
  const myReplies = asMyReplies(await readJsonOrNull(path.join(dataDir, "my-replies.json")));
  const replies = [
    ...replyRowsFromMyReplies(persona.id, myReplies, voice.pairs, {
      commentByReplyId: await commentsFromLedger(dataDir),
      gate: persona.gate,
    }),
    ...replyRowsFromQaPairs(persona.id, voice.qa, { gate: persona.gate, permalinkByComment: await permalinksFromVoicePairs(dataDir) }),
  ];
  return { personaId: persona.id, posts, replies };
}

// 검색마다 파일 2,500건을 다시 읽지 않게 5분 캐시. hot reload 에도 살아남게 globalThis.
const CACHE_MS = 5 * 60_000;
type CacheEntry = { at: number; value: LocalKnowledge };

function cache(): Map<string, CacheEntry> {
  const g = globalThis as typeof globalThis & { __replyKnowledgeLocal?: Map<string, CacheEntry> };
  g.__replyKnowledgeLocal ??= new Map();
  return g.__replyKnowledgeLocal;
}

export async function readLocalKnowledgeCached(personaId: string, nowMs = Date.now()): Promise<LocalKnowledge> {
  const hit = cache().get(personaId);
  if (hit && nowMs - hit.at < CACHE_MS) return hit.value;
  const value = await readLocalKnowledge(personaId);
  cache().set(personaId, { at: nowMs, value });
  return value;
}

// 낱말 무게(idf)를 잴 글 목록. 로컬 원천을 표로 쓴다 — DB 로 찾았어도 순위 다듬기는 여기서.
const docsFor = new WeakMap<LocalKnowledge, string[]>();

/** 검색어마다 드문 정도 무게. 로컬 원천을 못 읽으면 null (호출처는 무게 1로 간다). */
export async function termWeights(personaId: string, terms: readonly string[]): Promise<Map<string, number> | null> {
  try {
    const local = await readLocalKnowledgeCached(personaId);
    let docs = docsFor.get(local);
    if (!docs) {
      docs = [...local.posts.map((p) => p.body), ...local.replies.map((r) => `${r.body} ${r.comment_body ?? ""}`)].map((s) => s.toLowerCase());
      docsFor.set(local, docs);
    }
    return docs.length ? idfWeights(docs, terms) : null;
  } catch {
    return null;
  }
}
