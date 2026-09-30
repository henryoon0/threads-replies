// 지식 저장소의 행 모양과 순수 규칙 (docs/reply-persona-design.md 3-3, 3-4).
//
// 같은 행을 Supabase 에 올리고(backfill), DB 가 안 될 때는 로컬 JSON 에서 똑같이 만들어
// 메모리에서 찾는다. 그래서 행 만들기·검색어·점수 규칙은 여기 한 곳에만 둔다.
// 개인정보: 댓글 단 사람 아이디는 행에 넣지 않는다. 댓글 글만 comment_body 로 둔다.
//
// Pure — I/O 없음.

import { EMPTY_INSIGHTS, fullTextOf, type ArchivedPost } from "@/lib/threads-archive/model";
import { queryTerms as koreanTerms } from "@/lib/supplement/brain";

export interface PostRow {
  persona_id: string;
  id: string;
  body: string;
  permalink: string | null;
  posted_at: string | null;
  media_type: string | null;
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  synced_at: string;
}

export interface MyReplyRow {
  persona_id: string;
  id: string;
  body: string;
  comment_body: string | null;
  posted_at: string | null;
  replied_to_id: string | null;
  root_post_id: string | null;
  permalink: string | null;
  source: "api" | "dashboard" | "app" | "collected";
  learn: boolean;
  synced_at: string;
}

/** 검색 결과 한 건 (DB·로컬 공통). */
export interface KnowledgeHit {
  kind: "post" | "reply" | "doc";
  id: string;
  body: string;
  commentBody?: string;
  permalink?: string;
  postedAt?: string;
  learn: boolean;
  score: number;
}

/** my-replies.json 한 줄 */
export interface RawMyReply {
  id: string;
  text: string;
  timestamp?: string;
  permalink?: string;
  repliedToId?: string;
  rootPostId?: string;
}

/** voice-pairs.json 한 줄 (commenter 는 읽기만 하고 버린다) */
export interface RawVoicePair {
  comment: string;
  reply: string;
  at?: string;
}

/** 박약사 Q&A 한 쌍 */
export interface RawQaPair {
  q: string;
  a: string;
}

// ── 시각 ───────────────────────────────────────────────────

/** "2025-12-18T23:33:59+0000" 같은 Graph 시각을 ISO 로. 못 읽으면 null. */
export function isoOrNull(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const fixed = raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(fixed);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// ── 학습 제외 (말투 예시·입장 카드에 절대 쓰면 안 되는 답) ──────────

const RX_DRUG = /마운자로|위고비|삭센다|싹센다|젭바운드|오젬픽|세마글루타이드|터제파타이드|글리프/i;
const RX_DOSE_NEAR_INJECT =
  /(주사|펜)[^.!?\n]{0,20}(\d+(\.\d+)?\s*(mg|밀리)|저용량|고용량|용량|증량)|(\d+(\.\d+)?\s*(mg|밀리)|저용량|고용량|용량|증량)[^.!?\n]{0,20}(주사|펜)|\d+\s*펜/i;
// GLP-1 용량 단계(2.5 → 5 → 7.5 …)를 약 이름 없이 말한 답, "용량 올리면" 같은 증량 조언.
const RX_DOSE_STEP = /(^|[^\d.])(2\.5|7\.5|12\.5)(?![\d])|용량[을를은]?\s*(천천히\s*)?(올|내리|줄|늘)/;
// 처방약 이름 (박약사 실제 답에서 나온 것)
const RX_PRESCRIPTION = /기넥신|판시딜|미녹시딜|발라시클로버|락툴로오스|신지로이드|오마코|콘서타|루나팜/;
// 제품·브랜드·구매처 (박약사 실제 답 122개에서 뽑은 목록 + 흔한 직구 브랜드)
const RX_BRAND = new RegExp(
  [
    "비맥스", "임팩타민", "임패타민", "글루콤", "삐콤", "마그비", "알티쥐", "종근당", "뉴트리원", "sharp-ps",
    "쏜(?=\\s|\\(|꺼|거|껄|이|$)", "thorne", "아이허브", "iherb", "prohealth", "프로헬스", "웰틴", "wellteen",
    "마이칼디", "스마티팬츠", "프리페민", "바이크롬", "티라노", "ovavite", "바이오가이아", "볼그레", "훼럼포라",
    "헤모큐", "테라로직스", "오바시톨", "홀썸스토리", "나우푸드", "now foods", "고려은단", "리츄얼", "ritual",
    "엘레비트", "델피놀", "키포텐", "armra", "마이타민", "박카스", "우루사", "겔포스", "여명808", "판피린",
    "스파톤", "노자임", "마그밀", "센트룸", "솔가", "solgar", "닥터스베스트", "쿠팡", "코스트코", "지오영",
    "나만의닥터", "텐텐",
  ].join("|"),
  "i"
);
// "제품은 X 추천" 처럼 이름을 몰라도 권유 모양인 문장
const RX_PRODUCT_PUSH = /제품[은는이]?[^.!?\n]{0,25}추천|추천[^.!?\n]{0,6}제품/;

/**
 * 말투 예시·입장 카드에 쓰면 안 되는 답이면 이유를, 괜찮으면 null.
 * 처방약 이름·주사 용량·제품/브랜드 권유는 좋은 말투로 배워지면 안 된다 (설계 4-6).
 */
export function learnBlockReason(answer: string): string | null {
  if (RX_DRUG.test(answer)) return "처방약";
  if (RX_DOSE_NEAR_INJECT.test(answer) || RX_DOSE_STEP.test(answer)) return "용량";
  if (RX_PRESCRIPTION.test(answer)) return "처방약";
  if (RX_BRAND.test(answer) || RX_PRODUCT_PUSH.test(answer)) return "제품·브랜드";
  return null;
}

/** 관문 종류별 학습 허용. light(AICC)는 막지 않는다 — AI 도구 "추천"은 위험한 권유가 아니다. */
export function learnAllowed(answer: string, gate: "light" | "strict"): boolean {
  return gate === "light" || learnBlockReason(answer) === null;
}

// ── 행 만들기 ─────────────────────────────────────────────

function postRow(personaId: string, p: ArchivedPost, body: string): PostRow {
  const i = { ...EMPTY_INSIGHTS, ...p.insights };
  return {
    persona_id: personaId,
    id: p.id,
    body,
    permalink: p.permalink || null,
    posted_at: isoOrNull(p.timestamp),
    media_type: p.mediaType ?? null,
    views: i.views,
    likes: i.likes,
    replies: i.replies,
    reposts: i.reposts,
    quotes: i.quotes,
    synced_at: isoOrNull(p.syncedAt) ?? new Date(0).toISOString(),
  };
}

export function postRowsFromArchive(personaId: string, posts: readonly ArchivedPost[]): PostRow[] {
  const out: PostRow[] = [];
  for (const p of posts) {
    const body = fullTextOf(p).trim();
    if (p.id && body) out.push(postRow(personaId, p, body));
  }
  return out;
}

/** 답 글 + 시각으로 짝 댓글 찾기 표. 같은 글을 여러 번 단 경우가 있어 시각까지 묶는다. */
function pairKey(text: string, at: string | null | undefined): string {
  return `${isoOrNull(at) ?? ""}\n${text.trim()}`;
}

function pairIndex(pairs: readonly RawVoicePair[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of pairs) {
    const comment = (p.comment ?? "").trim();
    if (comment && (p.reply ?? "").trim()) out.set(pairKey(p.reply, p.at), comment);
  }
  return out;
}

type ReplyRowCtx = { personaId: string; gate: "light" | "strict"; syncedAt: string };

function myReplyRow(ctx: ReplyRowCtx, r: RawMyReply, body: string, comment: string | null): MyReplyRow {
  return {
    persona_id: ctx.personaId,
    id: r.id,
    body,
    comment_body: comment,
    posted_at: isoOrNull(r.timestamp),
    replied_to_id: r.repliedToId ?? null,
    root_post_id: r.rootPostId ?? null,
    permalink: r.permalink ?? null,
    source: "api",
    learn: learnAllowed(body, ctx.gate),
    synced_at: ctx.syncedAt,
  };
}

/**
 * 내가 단 답 → 행. comment_body 는 두 곳에서 채운다:
 *  - voice-pairs (답 글 + 시각으로 짝지음)
 *  - 원장 (댓글의 myReply.id 가 답 id)
 */
export function replyRowsFromMyReplies(
  personaId: string,
  items: readonly RawMyReply[],
  pairs: readonly RawVoicePair[],
  opts: { commentByReplyId?: ReadonlyMap<string, string>; gate?: "light" | "strict"; syncedAt?: string } = {}
): MyReplyRow[] {
  const ctx: ReplyRowCtx = { personaId, gate: opts.gate ?? "light", syncedAt: opts.syncedAt ?? new Date().toISOString() };
  const fromLedger = opts.commentByReplyId ?? new Map<string, string>();
  const byPair = pairIndex(pairs);
  const commentFor = (r: RawMyReply, body: string) => fromLedger.get(r.id) ?? byPair.get(pairKey(body, r.timestamp)) ?? null;
  const out: MyReplyRow[] = [];
  for (const r of items) {
    const body = String(r.text ?? "").trim();
    if (r.id && body) out.push(myReplyRow(ctx, r, body, commentFor(r, body)));
  }
  return out;
}

/** 짧은 해시 (FNV-1a 64비트 흉내 두 번) — 같은 Q&A 는 늘 같은 id 라 다시 올려도 겹치지 않는다. */
export function stableId(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function qaRow(
  personaId: string,
  id: string,
  comment: string,
  body: string,
  gate: "light" | "strict",
  syncedAt: string,
  permalinks?: ReadonlyMap<string, string>
): MyReplyRow {
  return {
    persona_id: personaId,
    id,
    body,
    comment_body: comment || null,
    posted_at: null,
    replied_to_id: null,
    root_post_id: null,
    permalink: permalinks?.get(comment) ?? null,
    source: "collected",
    learn: learnAllowed(body, gate),
    synced_at: syncedAt,
  };
}

/** 박약사 Q&A 쌍 → 행. strict 관문이면 위험한 답은 learn=false. */
export function replyRowsFromQaPairs(
  personaId: string,
  pairs: readonly RawQaPair[],
  opts: { gate?: "light" | "strict"; syncedAt?: string; permalinkByComment?: ReadonlyMap<string, string> } = {}
): MyReplyRow[] {
  const gate = opts.gate ?? "strict";
  const syncedAt = opts.syncedAt ?? new Date().toISOString();
  const out: MyReplyRow[] = [];
  const seen = new Set<string>();
  for (const p of pairs) {
    const body = (p.a ?? "").trim();
    const comment = (p.q ?? "").trim();
    if (!body) continue;
    const id = `qa-${stableId(`${comment}\n${body}`)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(qaRow(personaId, id, comment, body, gate, syncedAt, opts.permalinkByComment));
  }
  return out;
}

// ── 검색어 ────────────────────────────────────────────────

// 댓글 잡담에서 자주 나오지만 주제를 가르지 않는 말 (조사·어미를 뗀 뒤 모양).
const CHATTER = new Set([
  "감사", "감사합니다", "감사해", "좋은", "정말", "이제", "저도", "저는", "제가", "혹시", "근데", "그럼", "오늘",
  "어떻게", "있나", "있나요", "하나", "하나요", "같아", "같아요", "생각", "이런", "그런", "저런", "여기", "거기",
  "많이", "항상", "계속", "다들", "우리", "해야", "하는데", "해야하", "되나", "되나요", "합니다", "입니다", "있습니다",
  "글", "내용", "사람", "사용", "부분",
  // 존댓말 꼬리가 덜 떨어진 모양 ("하세요" → "하세")
  "하세", "하시", "해주", "주세", "드려", "드립", "있으", "없으", "싶어", "싶은", "했는", "하는", "되는", "되면",
  "했어", "해봐", "알려", "궁금해", "궁금하", "싶네", "그렇", "이렇", "저렇", "일할", "이상", "하면",
]);

// brain.ts 가 못 떼는 꼬리 (댓글 말투에 흔함). 뗀 뒤 2글자 이상 남을 때만 뗀다 — "결과"의 "과"를 지키려고.
const EXTRA_ENDINGS = ["이겠네", "겠네", "한거죠", "인거죠", "거죠", "한거", "인가", "네요", "군요", "죠", "땐", "와", "과", "한"];
// 흔한 오타·줄임말 → 글에 실제로 쓰는 말
const TERM_ALIASES: Record<string, string> = { 프롬포트: "프롬프트", 프롬프팅: "프롬프트", 클코: "클로드 코드", 지피티: "gpt", 챗지피티: "chatgpt" };

function stripExtraEnding(w: string): string {
  for (const e of EXTRA_ENDINGS) {
    if (w.endsWith(e) && Array.from(w).length - Array.from(e).length >= 2) return w.slice(0, -e.length);
  }
  return w;
}

/** 조사·어미를 뗀 검색 낱말. 자모만 있는 말(ㅋㅋ·ㅠㅠ)·잡담 낱말·"~야하" 같은 동사 조각은 뺀다. */
export function knowledgeTerms(text: string, max = 6): string[] {
  const out: string[] = [];
  for (const t of koreanTerms(text, 30)) {
    const base = stripExtraEnding(t.toLowerCase());
    const w = TERM_ALIASES[base] ?? base;
    if (/^[ㄱ-ㅎㅏ-ㅣ]+$/.test(w) || CHATTER.has(w) || /^\d+$/.test(w) || /(야하|할땐|할때)$/.test(w)) continue;
    if (!out.includes(w)) out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 낱말 무게 = 드문 정도 (idf). 모든 글에 나오는 "결과"보다 몇 군데만 나오는 "effort"가 주제를 가른다.
 * docs 는 소문자로 바꾼 글 목록. 한 번도 안 나오는 낱말(오타 등)은 무게 0 — 주제를 정할 자격이 없다.
 */
export function idfWeights(docs: readonly string[], terms: readonly string[]): Map<string, number> {
  const n = docs.length;
  const out = new Map<string, number>();
  for (const t of terms) {
    let df = 0;
    for (const d of docs) if (d.includes(t)) df += 1;
    out.set(t, df === 0 ? 0 : Math.log((n + 1) / (df + 1)) + 1);
  }
  return out;
}

/**
 * 검색에 보낼 낱말: 가장 드문 낱말 무게의 절반 이상인 것만. "클로드 100달러"에서 흔한 "클로드"를 빼야
 * "100달러"를 말한 한 건이 흔한 글 140개에 묻히지 않는다. 무게표가 없으면 그대로.
 */
export function retrievalTerms(terms: readonly string[], weights?: ReadonlyMap<string, number> | null, share = 0.5): string[] {
  if (!weights) return [...terms];
  const max = Math.max(0, ...terms.map((t) => weights.get(t) ?? 0));
  if (max <= 0) return [...terms];
  return terms.filter((t) => (weights.get(t) ?? 0) >= max * share);
}

/** 걸린 낱말 무게 합. 무게표가 없으면 낱말마다 1. */
export function weightedMatch(
  hit: Pick<KnowledgeHit, "body" | "commentBody">,
  terms: readonly string[],
  weights?: ReadonlyMap<string, number>
): number {
  const body = hit.body.toLowerCase();
  const comment = (hit.commentBody ?? "").toLowerCase();
  let s = 0;
  for (const t of terms) if (body.includes(t) || comment.includes(t)) s += weights?.get(t) ?? 1;
  return s;
}

/** pgroonga &@~ 질의: "낱말1" OR "낱말2". 따옴표로 감싸 질의 문법 글자(-, :, 괄호)를 그대로 찾는다. */
export function toGroongaQuery(terms: readonly string[]): string {
  return terms.map((t) => `"${t.replace(/["\\]/g, "\\$&")}"`).join(" OR ");
}

/** 한 건이 검색어 몇 개를 품는지 (본문 또는 짝 댓글). 관련도 문턱에 쓴다. */
export function matchedTermCount(hit: Pick<KnowledgeHit, "body" | "commentBody">, terms: readonly string[]): number {
  const body = hit.body.toLowerCase();
  const comment = (hit.commentBody ?? "").toLowerCase();
  let n = 0;
  for (const t of terms) if (body.includes(t) || comment.includes(t)) n += 1;
  return n;
}

/** 로컬 점수: 본문에 있으면 2, 짝 댓글에만 있으면 1 (pgroonga 순위와 비슷한 순서가 나오게). */
export function localScore(hit: Pick<KnowledgeHit, "body" | "commentBody">, terms: readonly string[]): number {
  const body = hit.body.toLowerCase();
  const comment = (hit.commentBody ?? "").toLowerCase();
  let s = 0;
  for (const t of terms) {
    if (body.includes(t)) s += 2;
    else if (comment.includes(t)) s += 1;
  }
  return s;
}

export function postRowToHit(r: PostRow, score = 0): KnowledgeHit {
  return {
    kind: "post",
    id: r.id,
    body: r.body,
    permalink: r.permalink ?? undefined,
    postedAt: r.posted_at ?? undefined,
    learn: true,
    score,
  };
}

export function replyRowToHit(r: MyReplyRow, score = 0): KnowledgeHit {
  return {
    kind: "reply",
    id: r.id,
    body: r.body,
    commentBody: r.comment_body ?? undefined,
    permalink: r.permalink ?? undefined,
    postedAt: r.posted_at ?? undefined,
    learn: r.learn,
    score,
  };
}

/** 로컬 행에서 찾기: 점수 > 0 인 것을 점수·최신 순으로. */
export function rankLocal(hits: readonly KnowledgeHit[], terms: readonly string[], limit: number): KnowledgeHit[] {
  if (!terms.length) return [];
  return hits
    .map((h) => ({ ...h, score: localScore(h, terms) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
    .slice(0, limit);
}
