// 근거 찾기 프롬프트 · 응답 해석 · 순위 (순수, 2026-09-27).
//
// 프롬프트 원칙 (claude-api 스킬, Opus 5.5): 할 일을 긍정형으로 구체적으로, 실제 예시 한두 개,
// 필요한 출력 모양만 요구, 어시스턴트 prefill 없음. 금지문을 쌓지 않는다.
import type { AnswerSource, ThreadsPostRef, ThreadsReply } from "./model";
import type { EvidenceDoc, IndexRow } from "./evidence-index";
import { locateVerbatim } from "./passage";

const POST_CHARS = 700;

function questionBlock(reply: ThreadsReply, post: ThreadsPostRef): string {
  const prev = reply.repliedToText ? `\n(이 댓글은 주인 의 답글 "${reply.repliedToText.slice(0, 300)}" 에 이어 단 것)` : "";
  return `계정 주인의 스레드 글 (${post.timestamp.slice(0, 10)}):
"""
${post.text.slice(0, POST_CHARS)}
"""

이 글에 달린 질문 댓글 (@${reply.username}):
"""
${reply.text}
"""${prev}`;
}

// ── 2단계: 색인 한 장에서 고르기 ────────────────────────────────

export const MAX_PICKS = 6;

export function buildPickPrompt(
  reply: ThreadsReply,
  post: ThreadsPostRef,
  sheet: string,
  hasCandidates: boolean
): string {
  const candidateNote = hasCandidates
    ? `\n[원본] 줄은 주인 가 이 글을 쓸 무렵 모아 둔 재료 후보입니다. 글이 소개한 사례의 원문이 그중에 있으면 꼭 고르세요.`
    : "";
  return `${questionBlock(reply, post)}

주인 가 이 질문에 답글을 달 때 근거로 인용할 자료를 아래 색인에서 고르세요.
한 줄 = 자료 하나: "번호 [종류] 연.월 제목 | 별칭". 종류: 원본=글의 재료가 된 원문, 자료=주인이 모아 둔 자료·주인이 직접 답한 노트, 글=주인의 지난 스레드 글.${candidateNote}

고르는 기준:
- 질문에 대한 답(사실·방법·주인 의 경험)이 그 자료 안에 들어 있을 것 같은 자료
- 질문이 글 속 사례를 묻는다면, 그 사례를 다룬 원문·수집노트
- 질문 속 제품·사람 이름이 별칭에 있는 자료

예) 질문 "클코에서 스킬은 어떻게 설치해요?" → 별칭에 "클로드 코드", "스킬 설치"가 있는 수집노트·강의 자료를 고른다.
예) 질문 "Zed 편집기랑 뭐가 달라요?" 인데 Zed 를 다룬 자료가 없다 → 빈 목록.

답에 도움이 될 자료만 관련 높은 순으로 최대 ${MAX_PICKS}개. 하나도 없으면 빈 목록이 정답입니다.

색인:
${sheet}

JSON 하나만 답하세요.
{"picks": [{"row": "r12", "why": "한 줄 이유"}]}`;
}

/** 모델 JSON 항목의 필드 하나를 문자열로 (없으면 빈 문자열) */
function pickField(item: unknown, key: string): string {
  return String((item as Record<string, unknown> | undefined)?.[key] ?? "");
}

export function parsePicks(parsed: unknown, rows: readonly IndexRow[]): { docId: string; why: string }[] {
  const picks = (parsed as { picks?: unknown })?.picks;
  if (!Array.isArray(picks)) return [];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out: { docId: string; why: string }[] = [];
  const seen = new Set<string>();
  for (const p of picks) {
    const row = byKey.get(pickField(p, "row").trim());
    if (!row || seen.has(row.docId)) continue;
    seen.add(row.docId);
    out.push({ docId: row.docId, why: pickField(p, "why").slice(0, 200) });
    if (out.length >= MAX_PICKS) break;
  }
  return out;
}

// ── 3단계: 원문 그대로 인용 뽑기 ─────────────────────────────────

export interface ExtractInput {
  doc: EvidenceDoc;
  excerpt: string;
}

/**
 * strict: 답이 담긴 문장만 (주제 소개문은 건너뜀) — "근거 없음"을 잘 지킨다.
 * lenient: 답의 배경이 되는 문장도 partial 로 받는다 — 근거를 더 많이 붙이지만 오탐이 는다.
 * 어느 쪽이 나은지는 retrieval-eval 로 잰다.
 */
export type ExtractMode = "strict" | "lenient";

function extractRules(mode: ExtractMode): string {
  if (mode === "lenient") {
    return `- support: 질문에 바로 답하면 "direct", 답의 일부나 배경이면 "partial".
- 질문에 도움이 안 되는 자료는 건너뜁니다. 어느 자료도 도움이 안 되면 빈 목록이 정답입니다.`;
  }
  return `- support: 질문에 바로 답하면 "direct", 답의 일부(질문이 묻는 것의 한쪽만)면 "partial".
- 질문이 묻는 것(가능 여부·방법·차이·이유·사실)에 대한 정보가 담긴 문장만 고릅니다. 주제만 같고 답은 없는 소개 문장은 건너뜁니다. 어느 자료에도 답이 없으면 빈 목록이 정답이고, 그러면 주인 가 "확인해보고 알려드릴게요"로 솔직하게 답합니다.

예) 질문 "Windsurf 랑 비교하면 뭐가 나아요?" 인데 자료에는 Cursor 소개("Cursor is an AI code editor.")만 있고 Windsurf 이야기는 없다 → 빈 목록.`;
}

export function buildExtractPrompt(
  reply: ThreadsReply,
  post: ThreadsPostRef,
  items: readonly ExtractInput[],
  mode: ExtractMode = "strict"
): string {
  const blocks = items
    .map((it, i) => `<doc id="d${i + 1}" kind="${it.doc.kind}" title="${it.doc.title.replace(/"/g, "'").slice(0, 100)}">\n${it.excerpt}\n</doc>`)
    .join("\n\n");
  return `${questionBlock(reply, post)}

아래 자료에서 이 질문에 답하는 데 쓸 문장을 찾아 원문 그대로 옮겨 주세요. 주인 가 답글의 근거로 보여주고, 원문 화면에서 그 문장에 형광펜을 칠합니다.

옮기는 법:
- 자료 안의 연속된 문장 1~3개를 글자 하나 바꾸지 않고 복사합니다. 영어 원문은 영어 그대로 둡니다.
- 자료 하나에서 가장 답에 가까운 한 곳만 고릅니다. 300자 안쪽.
${extractRules(mode)}

예) 질문 "옵시디언 플러그인 없이도 되나요?" 이고 자료에 "Works with any Markdown folder — no plugin required." 가 있다 → {"doc": "d2", "quote": "Works with any Markdown folder — no plugin required.", "support": "direct"}

${blocks}

JSON 하나만 답하세요.
{"passages": [{"doc": "d1", "quote": "원문 그대로", "support": "direct"}]}`;
}

export type Support = "direct" | "partial";

export interface ExtractedPassage {
  doc: EvidenceDoc;
  quote: string;
  support: Support;
}

/** 모델이 준 인용을 원문에서 다시 찾는다. 원문에 없는 인용(의역·환각)은 버리고 수를 센다. */
export function verifyPassages(
  parsed: unknown,
  items: readonly ExtractInput[]
): { passages: ExtractedPassage[]; dropped: number } {
  const list = (parsed as { passages?: unknown })?.passages;
  if (!Array.isArray(list)) return { passages: [], dropped: 0 };
  const passages: ExtractedPassage[] = [];
  let dropped = 0;
  for (const p of list) {
    const item = items[Number(pickField(p, "doc").replace(/^d/, "")) - 1];
    const quote = pickField(p, "quote");
    if (!item || !quote.trim()) continue;
    const exact = locateVerbatim(item.doc.text, quote);
    if (!exact) {
      dropped += 1;
      continue;
    }
    const support: Support = (p as { support?: unknown })?.support === "partial" ? "partial" : "direct";
    passages.push({ doc: item.doc, quote: exact, support });
  }
  return { passages, dropped };
}

// ── 5단계: 웹 ─────────────────────────────────────────────────

export function buildWebPrompt(reply: ThreadsReply, post: ThreadsPostRef): string {
  return `${questionBlock(reply, post)}

주인 의 자료에는 이 질문의 답이 없습니다. 웹을 검색해 답이 되는 공식 문서·원문 글을 최대 3개 찾아 주세요.
공식 문서, 제품 발표, 작성자 본인의 글을 먼저 찾습니다. quote 에는 그 페이지 본문 문장을 그대로 복사합니다(번역하지 않음).

JSON 하나만 답하세요. 못 찾으면 빈 목록.
{"results": [{"title": "페이지 제목", "url": "https://...", "quote": "본문 그대로"}]}`;
}

export function parseWebResults(parsed: unknown): { title: string; url: string; quote: string }[] {
  const list = (parsed as { results?: unknown })?.results;
  if (!Array.isArray(list)) return [];
  return list
    .map((r) => ({
      title: String((r as { title?: unknown })?.title ?? "").slice(0, 120),
      url: String((r as { url?: unknown })?.url ?? "").trim(),
      quote: String((r as { quote?: unknown })?.quote ?? ""),
    }))
    .filter((r) => /^https?:\/\//.test(r.url) && r.quote.trim())
    .slice(0, 3);
}

// ── 순위 · 중복 제거 ─────────────────────────────────────────────

export type Stage = "link" | "anchor" | "index" | "web";

export interface RankCandidate extends ExtractedPassage {
  stage: Stage;
  /** 같은 단계 안의 순서 (고른 순위). 작을수록 앞. */
  order: number;
}

const STAGE_BONUS: Record<Stage, number> = { link: 3, anchor: 2, index: 1, web: 0 };

/** 링크 글의 앞부분을 원문 그대로 자른다. 문장 끝(. ! ? 줄바꿈)에서 끊고, 없으면 maxChars 에서 끊는다. */
export function leadingPassage(text: string, maxChars = 220): string {
  const body = text.trim();
  if (body.length <= maxChars) return body;
  const head = body.slice(0, maxChars);
  let end = -1;
  for (const m of head.matchAll(/[.!?](?=\s|$)|\n/g)) end = m.index + 1;
  return (end >= 60 ? head.slice(0, end) : head).trim();
}

/**
 * henry 가 직접 붙인 링크는 질문에 딱 맞는 문장이 없어도 근거로 남긴다 (09-27 QA: 추출 단계가
 * 엄격해 붙인 링크가 통째로 사라졌다). 인용은 글 앞부분 원문 그대로라 형광 캡처가 찾을 수 있다.
 */
export function keepPastedLinks(cands: RankCandidate[], links: EvidenceDoc[]): RankCandidate[] {
  const have = new Set(cands.map((c) => c.doc.id));
  const kept = links
    .filter((d) => !have.has(d.id) && d.text.trim())
    .map((doc, i): RankCandidate => ({ doc, quote: leadingPassage(doc.text), support: "partial", stage: "link", order: i }));
  return [...cands, ...kept];
}

function foldQuote(q: string): string {
  return q.replace(/\s+/g, " ").trim().toLowerCase();
}

function urlKey(u: string | undefined): string {
  return (u ?? "").trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "").replace("twitter.com", "x.com");
}

/**
 * 점수 = 답 직접성(direct 10 / partial 5) + 단계 가산(붙인 링크 > 원글 원본 > 색인 > 웹) − 순서.
 * 문서 하나에 한 건, 같은 원문 링크 한 건, 같은(또는 포함되는) 인용 한 건. 최대 max 건, id 는 s1.. .
 */
export function rankSources(cands: readonly RankCandidate[], max = 5): AnswerSource[] {
  const scored = cands
    .map((c) => ({ c, s: (c.support === "direct" ? 10 : 5) + STAGE_BONUS[c.stage] - c.order * 0.1 }))
    .sort((a, b) => b.s - a.s);
  const docs = new Set<string>();
  const urls = new Set<string>();
  const quotes: string[] = [];
  const out: AnswerSource[] = [];
  for (const { c } of scored) {
    if (out.length >= max) break;
    const q = foldQuote(c.quote);
    const u = urlKey(c.doc.url);
    if (docs.has(c.doc.id)) continue;
    if (u && urls.has(u)) continue;
    if (quotes.some((k) => k.includes(q) || q.includes(k))) continue;
    docs.add(c.doc.id);
    if (u) urls.add(u);
    quotes.push(q);
    out.push({
      id: `s${out.length + 1}`,
      kind: c.doc.kind,
      title: c.doc.title,
      quote: c.quote,
      ...(c.doc.url ? { url: c.doc.url } : {}),
      origin: c.doc.origin,
    });
  }
  return out;
}
