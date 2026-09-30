// 지식 어댑터: Supabase(henry-dashboard 프로젝트)의 reply_search 로 내 글·내 답글을 찾는다.
// 설계: docs/reply-persona-design.md 3-3. 표·함수: supabase/migrations/20260929000000_reply_knowledge.sql
//
// DB 가 설정되지 않았거나, 끊겼거나, 느리면 같은 행을 로컬 JSON 에서 만들어 메모리에서 찾는다.
// 결과에는 어느 쪽이 답했는지(source)를 늘 적는다 — "DB 로 찾았다"고 착각하지 않게.
//
// 서버 전용 (service key 사용).

import { dashboardDb, dashboardDbConfigured } from "@/lib/db/supabase";
import { envMs } from "@/lib/threads-replies/storage";
import {
  knowledgeTerms,
  postRowToHit,
  rankLocal,
  replyRowToHit,
  toGroongaQuery,
  type KnowledgeHit,
  type MyReplyRow,
  type PostRow,
} from "./rows";
import { readLocalKnowledgeCached } from "./sources";

export type KnowledgeSource = "supabase" | "local";

export interface KnowledgeSearchResult {
  hits: KnowledgeHit[];
  source: KnowledgeSource;
  terms: string[];
  /** 로컬로 돌아간 이유 (DB 미설정·오류·시간 초과·DB 0건) */
  fallbackReason?: string;
}

/** DB 검색 한 번의 하드 상한. 넘으면 로컬로 간다. */
export function knowledgeTimeoutMs(): number {
  return envMs("REPLY_KNOWLEDGE_TIMEOUT_MS", 4_000);
}

// DB 가 한 번 실패하면 잠깐(기본 60초) 로컬만 쓴다. 기한이 지나면 저절로 풀린다 (sticky 해제 조건).
function downUntil(): { at: number; reason: string } {
  const g = globalThis as typeof globalThis & { __replyKnowledgeDown?: { at: number; reason: string } };
  g.__replyKnowledgeDown ??= { at: 0, reason: "" };
  return g.__replyKnowledgeDown;
}

function markDown(reason: string): void {
  const d = downUntil();
  d.at = Date.now() + envMs("REPLY_KNOWLEDGE_RETRY_MS", 60_000);
  d.reason = reason;
}

type SearchRow = {
  kind: "post" | "reply" | "doc";
  id: string;
  body: string;
  comment_body: string | null;
  permalink: string | null;
  posted_at: string | null;
  learn: boolean;
  score: number;
};

function rowToHit(r: SearchRow): KnowledgeHit {
  return {
    kind: r.kind,
    id: r.id,
    body: r.body,
    commentBody: r.comment_body ?? undefined,
    permalink: r.permalink ?? undefined,
    postedAt: r.posted_at ?? undefined,
    learn: r.learn,
    score: Number(r.score) || 0,
  };
}

async function searchDb(personaId: string, terms: string[], limit: number, kind: "post" | "reply"): Promise<KnowledgeHit[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), knowledgeTimeoutMs());
  try {
    const { data, error } = await dashboardDb()
      .rpc("reply_search", { p_persona: personaId, p_query: toGroongaQuery(terms), p_limit: limit, p_kind: kind })
      .abortSignal(ctrl.signal);
    if (error) throw new Error(error.message || "reply_search 실패");
    return ((data ?? []) as SearchRow[]).map(rowToHit);
  } catch (error) {
    if (ctrl.signal.aborted) throw new Error(`시간 초과(${knowledgeTimeoutMs()}ms)`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function searchLocal(personaId: string, terms: string[], limit: number, kind: "post" | "reply"): Promise<KnowledgeHit[]> {
  const local = await readLocalKnowledgeCached(personaId);
  const pool = kind === "post" ? local.posts.map((r: PostRow) => postRowToHit(r)) : local.replies.map((r: MyReplyRow) => replyRowToHit(r));
  return rankLocal(pool, terms, limit);
}

type SearchOpts = { learnOnly?: boolean; terms?: string[] };

/** DB 로 찾기. 쓸 수 없으면 로컬로 갈 이유를 돌려준다. */
async function tryDb(personaId: string, terms: string[], ask: number, kind: "post" | "reply"): Promise<{ hits: KnowledgeHit[] } | { reason: string }> {
  if (!dashboardDbConfigured()) return { reason: "DB 미설정" };
  const down = downUntil();
  if (down.at > Date.now()) return { reason: `DB 잠시 쉼: ${down.reason}` };
  try {
    return { hits: await searchDb(personaId, terms, ask, kind) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    markDown(reason);
    return { reason };
  }
}

/** learn=false 를 거르고도 limit 개가 남도록 넉넉히 받고(ask), 받은 뒤 거른다(keep). */
function sizing(limit: number, learnOnly: boolean) {
  return {
    ask: learnOnly ? limit * 3 : limit,
    keep: (hits: KnowledgeHit[]) => (learnOnly ? hits.filter((h) => h.learn) : hits).slice(0, limit),
  };
}

async function search(personaId: string, query: string, limit: number, kind: "post" | "reply", opts: SearchOpts): Promise<KnowledgeSearchResult> {
  const terms = opts.terms?.length ? opts.terms : knowledgeTerms(query);
  if (!terms.length) return { hits: [], source: "local", terms, fallbackReason: "검색어 없음" };
  const { ask, keep } = sizing(limit, opts.learnOnly === true);

  const db = await tryDb(personaId, terms, ask, kind);
  const dbHits = "hits" in db ? keep(db.hits) : [];
  if (dbHits.length) return { hits: dbHits, source: "supabase", terms };
  const reason = "reason" in db ? db.reason : "DB 0건";
  const hits = keep(await searchLocal(personaId, terms, ask, kind));
  // DB 가 정상인데 0건이고 로컬도 0건이면 DB 결과로 본다.
  if (!hits.length && "hits" in db) return { hits, source: "supabase", terms };
  return { hits, source: "local", terms, fallbackReason: reason };
}

/**
 * 내가 단 답글에서 찾기 (본문 + 짝 댓글). learnOnly 면 학습 제외 답(처방약·제품 권유)을 뺀다.
 * terms 를 주면 query 대신 그 낱말로 찾는다 (호출처가 드문 낱말만 골랐을 때).
 */
export function searchPastReplies(personaId: string, query: string, limit = 8, opts: SearchOpts = {}): Promise<KnowledgeSearchResult> {
  return search(personaId, query, limit, "reply", opts);
}

/** 내 글(첫 칸 + 이어 쓴 칸)에서 찾기. */
export function searchPosts(personaId: string, query: string, limit = 5, opts: Omit<SearchOpts, "learnOnly"> = {}): Promise<KnowledgeSearchResult> {
  return search(personaId, query, limit, "post", opts);
}

// ── 올리기 (backfill·동기화) ─────────────────────────────────

export type KnowledgeTable = "reply_posts" | "reply_my_replies";

/** 있으면 고치고 없으면 넣는다. batchSize 개씩. 실패하면 몇 번째 묶음인지와 함께 던진다. */
export async function upsertKnowledgeRows(
  table: KnowledgeTable,
  rows: readonly (PostRow | MyReplyRow)[],
  batchSize = 200
): Promise<number> {
  const db = dashboardDb();
  let done = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await db.from(table).upsert(chunk as never[], { onConflict: "persona_id,id" });
    if (error) throw new Error(`${table} ${i / batchSize + 1}번째 묶음 실패: ${error.message}`);
    done += chunk.length;
  }
  return done;
}

/** 표에 든 한 페르소나의 행 수 (backfill 확인용). */
export async function countKnowledgeRows(table: KnowledgeTable, personaId: string, learnOnly = false): Promise<number> {
  let q = dashboardDb().from(table).select("id", { count: "exact", head: true }).eq("persona_id", personaId);
  if (learnOnly) q = q.eq("learn", true);
  const { count, error } = await q;
  if (error) throw new Error(`${table} 세기 실패: ${error.message}`);
  return count ?? 0;
}
