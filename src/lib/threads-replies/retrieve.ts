// 스레드 질문 댓글의 근거 찾기 (2026-09-27). 단계마다 실패해도 다음 단계로 간다(trace 에 남김).
//
//   1 anchor  이 글의 재료(X 원문·답글) — 가장 정확
//   2 index   색인 한 장(수집노트·카드·수집한 원문·강의 모듈·FAQ·지난 글 + 별칭) → 모델이 고름("없음" 허용)
//   3 extract 고른 자료 + 원글 원본에서 원문 그대로 인용 뽑기 → 코드로 부분 문자열 확인
//   4 links   henry 가 끌어 놓은 링크 본문 → 같은 방식으로 인용 (kind 붙인 링크)
//   5 web     allowWeb 이고 1~4 가 빈손일 때만 (kind 웹, 페이지를 다시 읽어 인용 확인)
//
// 모델 선택은 scripts/threads-replies/retrieval-eval.ts 실측으로 정했다 (DEFAULT_CONFIG 주석).
import { runClaudeCLI } from "@/lib/ai/claude-cli";
import { parseJsonObject } from "@/lib/ai/json";
import type { AnswerSource, ThreadsPostRef, ThreadsReply } from "./model";
import { loadEvidenceCorpus } from "./evidence-docs";
import { fillAliases, readAliasCache, warmAliasesInBackground } from "./evidence-aliases";
import { buildIndexRows, docsMissingAliases, formatIndexSheet, type EvidenceDoc } from "./evidence-index";
import { fetchLinkDoc } from "./link-fetch";
import { locateVerbatim, queryTerms, selectExcerpt } from "./passage";
import { normalizeSourceUrl } from "./run-source";
import {
  buildExtractPrompt,
  buildPickPrompt,
  buildWebPrompt,
  keepPastedLinks,
  parsePicks,
  parseWebResults,
  rankSources,
  verifyPassages,
  type ExtractInput,
  type ExtractMode,
  type ExtractedPassage,
  type RankCandidate,
  type Stage,
} from "./retrieve-prompts";
import { envMs } from "./storage";

export interface RetrieveConfig {
  pickModel: string;
  pickEffort: string;
  extractModel: string;
  extractEffort: string;
  extractMode: ExtractMode;
}

// 실측 (retrieval-eval, 21문항): opus low 가 haiku 보다 hit@5 도 높고(9 vs 5~8/14) CLI 대기 탓에
// 오히려 빠르다. strict 추출이 "근거 없음" 6/7 을 지킨다. 결과표는 retrieval-eval.ts 머리 주석.
export const DEFAULT_CONFIG: RetrieveConfig = {
  pickModel: process.env.THREADS_REPLIES_PICK_MODEL || "claude-opus-5-5",
  pickEffort: process.env.THREADS_REPLIES_PICK_EFFORT || "low",
  extractModel: process.env.THREADS_REPLIES_EXTRACT_MODEL || "claude-opus-5-5",
  extractEffort: process.env.THREADS_REPLIES_EXTRACT_EFFORT || "low",
  extractMode: process.env.THREADS_REPLIES_EXTRACT_MODE === "lenient" ? "lenient" : "strict",
};

const MAX_SOURCES = 5;
const MAX_ANCHORS = 6;
const INLINE_ALIAS_LIMIT = 30;
const EXTRACT_BUDGET_CHARS = 48_000;
const EXTRACT_DOC_MAX_CHARS = 9_000;
const EXTRACT_GROUP = 7;

export type RetrieveTrace = { stage: string; ms: number; count: number; note?: string }[];

export interface RetrieveInput {
  reply: ThreadsReply;
  post: ThreadsPostRef;
  extraLinks?: string[];
  allowWeb?: boolean;
  signal?: AbortSignal;
}

function errText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 160);
}

async function timed<T>(
  trace: RetrieveTrace,
  stage: string,
  fn: () => Promise<T>,
  count: (v: T) => number,
  note?: (v: T) => string | undefined
): Promise<T | null> {
  const t0 = Date.now();
  try {
    const v = await fn();
    trace.push({ stage, ms: Date.now() - t0, count: count(v), ...(note?.(v) ? { note: note(v) } : {}) });
    return v;
  } catch (e) {
    trace.push({ stage, ms: Date.now() - t0, count: 0, note: `실패: ${errText(e)}` });
    return null;
  }
}

/** 원글 원본이 많을 때(사례 모음 9건 등) 질문·글과 낱말이 많이 겹치는 것부터. */
function topAnchors(anchors: EvidenceDoc[], terms: string[]): EvidenceDoc[] {
  if (anchors.length <= MAX_ANCHORS) return anchors;
  const score = (d: EvidenceDoc) => {
    const l = d.text.toLowerCase();
    return terms.reduce((s, t) => s + (l.includes(t) ? 1 : 0), 0);
  };
  return [...anchors].sort((a, b) => score(b) - score(a)).slice(0, MAX_ANCHORS);
}

/**
 * 색인에 올릴 문서: 후보 원본 + 전체 자료. 이 글 자신, 그리고 원글 원본(1단계 확정·후보)과 같은
 * 원문(id 또는 url)인 수집한 원문은 뺀다 — 같은 원문이 두 줄로 보이지 않게, 원글 원본 쪽 이름으로.
 */
export function indexDocs(postId: string, corpus: readonly EvidenceDoc[], anchors: readonly EvidenceDoc[], candidates: readonly EvidenceDoc[]): EvidenceDoc[] {
  const ids = new Set([...anchors, ...candidates].map((d) => d.id));
  const urls = new Set([...anchors, ...candidates].map((d) => normalizeSourceUrl(d.url)).filter(Boolean));
  const rest = corpus.filter(
    (d) =>
      d.id !== `post:${postId}` &&
      !ids.has(d.id) &&
      !(d.kind === "수집한 원문" && urls.has(normalizeSourceUrl(d.url)))
  );
  return [...candidates, ...rest];
}

async function pickFromIndex(
  input: RetrieveInput,
  cfg: RetrieveConfig,
  anchors: EvidenceDoc[],
  candidates: EvidenceDoc[],
  trace: RetrieveTrace
): Promise<EvidenceDoc[]> {
  const corpus = await loadEvidenceCorpus();
  const docs = indexDocs(input.post.id, corpus.docs, anchors, candidates);
  let cache = await readAliasCache();
  const missing = docsMissingAliases(docs, cache).length;
  if (missing > 0 && missing <= INLINE_ALIAS_LIMIT) {
    cache = (await fillAliases(docs, { limit: INLINE_ALIAS_LIMIT, signal: input.signal })).cache;
  } else if (missing > INLINE_ALIAS_LIMIT) {
    warmAliasesInBackground(docs);
  }
  const rows = buildIndexRows(docs, cache);
  const sheet = formatIndexSheet(rows);
  const raw = await runClaudeCLI(buildPickPrompt(input.reply, input.post, sheet, candidates.length > 0), {
    model: cfg.pickModel,
    effort: cfg.pickEffort,
    timeoutMs: envMs("THREADS_REPLIES_PICK_TIMEOUT_MS", 150_000),
    requireClaude: true,
    signal: input.signal,
    tmpPrefix: "threads-pick-",
  });
  const picks = parsePicks(parseJsonObject(raw), rows);
  const byId = new Map(docs.map((d) => [d.id, d]));
  trace.push({
    stage: "index-sheet",
    ms: 0,
    count: rows.length,
    note: `${sheet.length}자 · 별칭 없음 ${missing}${corpus.errors.length ? ` · 원천 실패 ${corpus.errors.join("; ")}` : ""}`,
  });
  return picks.map((p) => byId.get(p.docId)).filter((d): d is EvidenceDoc => !!d);
}

async function extractPassages(
  input: RetrieveInput,
  cfg: RetrieveConfig,
  docs: EvidenceDoc[],
  terms: string[]
): Promise<{ passages: ExtractedPassage[]; dropped: number }> {
  if (docs.length === 0) return { passages: [], dropped: 0 };
  const groups: EvidenceDoc[][] = [];
  for (let i = 0; i < docs.length; i += EXTRACT_GROUP) groups.push(docs.slice(i, i + EXTRACT_GROUP));
  const results = await Promise.allSettled(
    groups.map(async (group) => {
      const per = Math.min(EXTRACT_DOC_MAX_CHARS, Math.floor(EXTRACT_BUDGET_CHARS / group.length));
      const items: ExtractInput[] = group.map((doc) => ({ doc, excerpt: selectExcerpt(doc.text, terms, per) }));
      const raw = await runClaudeCLI(buildExtractPrompt(input.reply, input.post, items, cfg.extractMode), {
        model: cfg.extractModel,
        effort: cfg.extractEffort,
        timeoutMs: envMs("THREADS_REPLIES_EXTRACT_TIMEOUT_MS", 180_000),
        requireClaude: true,
        signal: input.signal,
        tmpPrefix: "threads-extract-",
      });
      return verifyPassages(parseJsonObject(raw), items);
    })
  );
  const passages: ExtractedPassage[] = [];
  let dropped = 0;
  const failures: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      passages.push(...r.value.passages);
      dropped += r.value.dropped;
    } else failures.push(errText(r.reason));
  }
  if (failures.length === results.length) throw new Error(failures.join("; "));
  return { passages, dropped };
}

async function webFallback(input: RetrieveInput): Promise<RankCandidate[]> {
  const raw = await runClaudeCLI(buildWebPrompt(input.reply, input.post), {
    model: "claude-opus-5-5",
    effort: "low",
    allowWebSearch: true,
    timeoutMs: envMs("THREADS_REPLIES_WEB_TIMEOUT_MS", 240_000),
    requireClaude: true,
    signal: input.signal,
    tmpPrefix: "threads-web-",
  });
  const found = parseWebResults(parseJsonObject(raw));
  const linkTimeout = envMs("THREADS_REPLIES_LINK_TIMEOUT_MS", 25_000);
  // 검색 결과 요약은 믿지 않고 페이지를 다시 읽어 인용이 실제로 있는지 확인한다
  const docs = await Promise.all(
    found.map((r) => fetchLinkDoc(r.url, { kind: "웹", idPrefix: "web", timeoutMs: linkTimeout, signal: input.signal }))
  );
  const out: RankCandidate[] = [];
  found.forEach((r, i) => {
    const doc = docs[i];
    if (!doc) return;
    const exact = locateVerbatim(doc.text, r.quote);
    if (!exact) return;
    out.push({ doc: { ...doc, title: r.title || doc.title }, quote: exact, support: "partial", stage: "web", order: i });
  });
  return out;
}

/** 4단계: 댓글에 붙인 링크(최대 5개)를 읽는다. 못 읽은 링크는 빼고 수를 남긴다 */
function readPastedLinks(input: RetrieveInput, trace: RetrieveTrace, linkTimeout: number) {
  return timed(
    trace,
    "links",
    async () =>
      (
        await Promise.all(
          (input.extraLinks ?? []).slice(0, 5).map((u) =>
            fetchLinkDoc(u, { kind: "붙인 링크", idPrefix: "link", timeoutMs: linkTimeout, signal: input.signal })
          )
        )
      ).filter((d): d is EvidenceDoc => !!d),
    (v) => v.length,
    (v) => ((input.extraLinks?.length ?? 0) > v.length ? `못 읽은 링크 ${(input.extraLinks?.length ?? 0) - v.length}` : undefined)
  );
}

/** 문서 id → 어느 단계에서 몇 번째로 골랐는지. 앞 단계(링크 > 원본 > 색인)가 먼저 차지한다 */
function stageMap(
  links: readonly EvidenceDoc[],
  anchors: readonly EvidenceDoc[],
  picked: readonly EvidenceDoc[]
): Map<string, { stage: Stage; order: number }> {
  const stageOf = new Map<string, { stage: Stage; order: number }>();
  links.forEach((d, i) => stageOf.set(d.id, { stage: "link", order: i }));
  anchors.forEach((d, i) => stageOf.has(d.id) || stageOf.set(d.id, { stage: "anchor", order: i }));
  picked.forEach((d, i) => stageOf.has(d.id) || stageOf.set(d.id, { stage: d.kind === "원글 원본" ? "anchor" : "index", order: i }));
  return stageOf;
}

/** 뽑은 인용에 그 자료를 고른 단계·순서를 붙인다 */
function withStage(
  extracted: { passages: ExtractedPassage[] } | null,
  stageOf: Map<string, { stage: Stage; order: number }>
): RankCandidate[] {
  return (extracted?.passages ?? []).map((p) => ({ ...p, ...stageOf.get(p.doc.id)! }));
}

/** 5단계 웹은 허용됐고, 앞 단계 인용이 하나도 없고, 취소되지 않았을 때만 */
function shouldTryWeb(input: RetrieveInput, cands: readonly RankCandidate[]): boolean {
  return !!input.allowWeb && cands.length === 0 && !input.signal?.aborted;
}

/** 질문 댓글 하나의 근거를 찾는다. 최대 5건, 순위·중복 제거 후. 던지지 않는다. */
export async function retrieveForReply(
  input: RetrieveInput,
  overrides: Partial<RetrieveConfig> = {}
): Promise<{ sources: AnswerSource[]; trace: RetrieveTrace }> {
  const cfg = { ...DEFAULT_CONFIG, ...overrides };
  const trace: RetrieveTrace = [];
  const terms = queryTerms(input.reply.text, input.reply.repliedToText ?? "", input.post.text.slice(0, 400));
  const linkTimeout = envMs("THREADS_REPLIES_LINK_TIMEOUT_MS", 25_000);

  // 4단계 링크 읽기는 네트워크라 먼저 띄워 두고 1·2단계와 겹친다
  const linksP = readPastedLinks(input, trace, linkTimeout);

  // 공유본엔 "이 글의 재료" 짝(대시보드 콘텐츠 보드)이 없다. 색인 단계만 쓴다.
  const anchor = await timed(trace, "anchor", async () => ({ anchors: [] as EvidenceDoc[], candidates: [] as EvidenceDoc[] }), (v) => v.anchors.length, (v) =>
    v.anchors.length ? undefined : `짝 없음 · 후보 원본 ${v.candidates.length}`
  );
  const anchorDocs = anchor?.anchors ?? [];
  const anchors = topAnchors(anchorDocs, terms);

  const picked =
    (await timed(
      trace,
      "index-pick",
      () => pickFromIndex(input, cfg, anchorDocs, anchor?.candidates ?? [], trace),
      (v) => v.length,
      (v) => v.map((d) => d.id).join(", ").slice(0, 400) || undefined
    )) ?? [];
  const links = (await linksP) ?? [];

  const stageOf = stageMap(links, anchors, picked);
  const all = [...links, ...anchors, ...picked].filter((d, i, arr) => arr.findIndex((x) => x.id === d.id) === i);

  const extracted = await timed(
    trace,
    "extract",
    () => extractPassages(input, cfg, all, terms),
    (v) => v.passages.length,
    (v) => `자료 ${all.length}건 · 원문에 없는 인용 버림 ${v.dropped}`
  );
  let cands: RankCandidate[] = keepPastedLinks(withStage(extracted, stageOf), links);

  if (shouldTryWeb(input, cands)) {
    cands = (await timed(trace, "web", () => webFallback(input), (v) => v.length)) ?? [];
  }

  const sources = rankSources(cands, MAX_SOURCES);
  trace.push({ stage: "rank", ms: 0, count: sources.length });
  return { sources, trace };
}
