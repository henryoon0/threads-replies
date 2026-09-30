// 박약사 팩의 근거 찾기 — 보충제 지식 뇌(GBrain) 검색 (설계 3-2 "gbrain" 어댑터, 2026-09-29).
//
// 공개 답글엔 제품 카드가 붙지 않는다. 그래서 근거는 두 종류만 넘긴다:
//   성분 페이지  = GBrain 페이지의 성분 설명·근거 칸 (근거 강도는 catalog.ts evidenceLabel 로 제목에)
//   팟캐스트 발언 = catalog 의 발언 요약 (관점일 뿐 추천 근거가 아니라는 표시를 제목에)
// 페이지의 "## 제품 데이터" 칸과 catalog 의 products 는 절대 넘기지 않는다.
// 붙인 링크가 있으면 본문을 읽어 질문 낱말이 걸린 조각을 "붙인 링크" 근거로 더한다.
// 던지지 않는다 — 검색이 실패하면 빈 근거와 trace 만 돌려준다.

import { readCatalog, evidenceLabel, type Catalog, type CatalogIngredient, type PodcastClaim } from "@/lib/supplement/catalog";
import { searchBrain, type BrainPage } from "@/lib/supplement/brain";
import type { AnswerSource } from "./model";
import type { EvidenceDoc } from "./evidence-index";
import { fetchLinkDoc } from "./link-fetch";
import { queryTerms, selectExcerpt } from "./passage";
import type { RetrieveInput, RetrieveTrace } from "./retrieve";
import { envMs } from "./storage";

const MAX_PAGES = 3;
const MAX_PODCAST = 3;
const CLAIMS_PER_INGREDIENT = 2;
const PAGE_QUOTE_CHARS = 900;
const LINK_QUOTE_CHARS = 900;

export interface BrainDeps {
  search?: (question: string, limit?: number) => Promise<{ terms: string[]; pages: BrainPage[] }>;
  catalog?: () => Promise<Catalog>;
  fetchLink?: typeof fetchLinkDoc;
}

// ── 순수 ─────────────────────────────────────────────────────────────

/** 페이지 원문에서 성분 설명·근거 칸만 남긴다 (앞머리 YAML·팟캐스트·제품 칸 제거). 원문의 연속 조각이다. */
export function pageEvidenceText(text: string): string {
  let body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  const cut = body.search(/\n##\s*(팟캐스트|제품)/);
  if (cut >= 0) body = body.slice(0, cut);
  return body.trim().slice(0, PAGE_QUOTE_CHARS).trim();
}

function catalogSlug(page: Pick<BrainPage, "slug">): string {
  return page.slug.replace(/^(ingredients|topics)\//, "");
}

export function ingredientFor(page: Pick<BrainPage, "slug">, catalog: Catalog | null): CatalogIngredient | undefined {
  const slug = catalogSlug(page);
  return catalog?.ingredients.find((i) => i.slug === slug);
}

export function pageSource(page: BrainPage, ingredient: CatalogIngredient | undefined, id: string): AnswerSource | null {
  const quote = pageEvidenceText(page.text);
  if (!quote) return null;
  const strength = ingredient ? evidenceLabel(ingredient.evidence) : undefined;
  return {
    id,
    kind: "성분 페이지",
    title: strength ? `${page.title} · ${strength}` : page.title,
    quote,
    origin: `gbrain:${page.slug}`,
    ...(strength ? { strength } : {}),
  };
}

const KIND_ORDER: Record<string, number> = { caveat: 0, mechanism: 1, dose_timing: 2, recommendation: 3, anecdote: 4 };
/** "뭐가 좋아?·추천해줘" 같은 고르기 질문엔 권하는 말·먹는 법이 먼저다. */
const CHOICE_ORDER: Record<string, number> = { recommendation: 0, dose_timing: 1, caveat: 2, mechanism: 3, anecdote: 4 };
const CHOICE_Q = /추천|좋은|좋을|뭐|뭘|어떤|어떻게|골라|고르|고를/;
/** 댓글 말 → 발언 요약에 쓰인 말 */
const CLAIM_SYNONYM: Record<string, string[]> = { 잠: ["수면", "불면"], 잠이: ["수면", "불면"], 피곤: ["피로"], 피곤해: ["피로"], 살: ["체중", "비만"], 변비: ["변비"] };

function claimText(c: PodcastClaim): string {
  return (c.claimKo ?? c.claim ?? "").trim();
}

function expand(terms: readonly string[]): string[] {
  return [...new Set(terms.flatMap((t) => [t, ...(CLAIM_SYNONYM[t] ?? [])]).map((t) => t.toLowerCase()))];
}

/**
 * 댓글 낱말이 많이 걸리는 발언 순. 모든 발언에 다 있는 말(성분 이름)은 가르는 힘이 없어 적게 친다.
 * 같으면 고르기 질문(choice)은 권하는 말 먼저, 아니면 주의·원리 발언 먼저.
 */
export function rankClaims(claims: readonly PodcastClaim[], terms: readonly string[], choice = false): PodcastClaim[] {
  const lowered = expand(terms);
  const withText = claims.filter((c) => claimText(c));
  const df = new Map(lowered.map((t) => [t, withText.filter((c) => claimText(c).toLowerCase().includes(t)).length]));
  const score = (c: PodcastClaim) => lowered.reduce((n, t) => n + (claimText(c).toLowerCase().includes(t) ? 1 / (df.get(t) || 1) : 0), 0);
  const order = choice ? CHOICE_ORDER : KIND_ORDER;
  return [...withText].sort((a, b) => score(b) - score(a) || (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
}

export function bestClaim(claims: readonly PodcastClaim[], terms: readonly string[], choice = false): PodcastClaim | undefined {
  return rankClaims(claims, terms, choice)[0];
}

/**
 * 발언 근거. quote = 자막 원문 그대로(영어), claimKo = 한국어 한 줄 요약.
 * 원문이 없던 예전 발언만 요약을 quote 로 쓴다. url 은 발언 시각(초)에서 열린다.
 */
export function podcastSource(claim: PodcastClaim, ingredient: CatalogIngredient, id: string): AnswerSource {
  const startSec = Math.max(0, Math.floor(claim.t));
  const minute = Math.floor(startSec / 60);
  const spoken = (claim.quote ?? "").trim();
  const ko = claimText(claim);
  return {
    id,
    kind: "팟캐스트 발언",
    title: `${claim.speaker} · ${ingredient.nameKo} (관점일 뿐, 추천 근거 아님)`,
    quote: spoken || ko,
    ...(spoken && ko ? { claimKo: ko } : {}),
    speaker: claim.speaker,
    videoTitle: claim.title,
    startSec,
    url: `https://www.youtube.com/watch?v=${claim.videoId}&t=${startSec}s`,
    origin: `catalog:${ingredient.slug}#podcast · ${claim.title} ${minute}분`,
  };
}

/** 페이지 → 성분 페이지 근거 + (성분마다 2개까지, 전체 최대 3개) 팟캐스트 발언 근거. id 는 s1, s2 … */
export function brainSources(pages: readonly BrainPage[], catalog: Catalog | null, terms: readonly string[], choice = false): AnswerSource[] {
  const out: AnswerSource[] = [];
  const claims: { claim: PodcastClaim; ingredient: CatalogIngredient }[] = [];
  const seen = new Set<string>();
  for (const page of pages.slice(0, MAX_PAGES)) {
    const ingredient = ingredientFor(page, catalog);
    const src = pageSource(page, ingredient, `s${out.length + 1}`);
    if (src) out.push(src);
    if (!ingredient) continue;
    // 같은 발언이 여러 성분(마그네슘·마그네슘 트레오네이트)에 걸려 있으면 한 번만
    const fresh = rankClaims(ingredient.podcast ?? [], terms, choice).filter((c) => !seen.has(`${c.videoId}@${c.t}`));
    for (const claim of fresh.slice(0, CLAIMS_PER_INGREDIENT)) {
      if (claims.length >= MAX_PODCAST) break;
      seen.add(`${claim.videoId}@${claim.t}`);
      claims.push({ claim, ingredient });
    }
  }
  for (const { claim, ingredient } of claims) out.push(podcastSource(claim, ingredient, `s${out.length + 1}`));
  return out;
}

function linkSource(doc: EvidenceDoc, terms: readonly string[], id: string): AnswerSource {
  return {
    id,
    kind: "붙인 링크",
    title: doc.title,
    quote: selectExcerpt(doc.text, terms, LINK_QUOTE_CHARS).slice(0, LINK_QUOTE_CHARS),
    url: doc.url,
    origin: doc.origin,
  };
}

// ── I/O ──────────────────────────────────────────────────────────────

async function timed<T>(trace: RetrieveTrace, stage: string, fn: () => Promise<T>, count: (v: T) => number, note?: (v: T) => string | undefined): Promise<T | null> {
  const t0 = Date.now();
  try {
    const v = await fn();
    trace.push({ stage, ms: Date.now() - t0, count: count(v), note: note?.(v) });
    return v;
  } catch (e) {
    trace.push({ stage, ms: Date.now() - t0, count: 0, note: (e instanceof Error ? e.message : String(e)).slice(0, 160) });
    return null;
  }
}

async function readLinks(input: RetrieveInput, deps: BrainDeps, trace: RetrieveTrace): Promise<EvidenceDoc[]> {
  const links = input.extraLinks ?? [];
  if (!links.length) return [];
  const fetch = deps.fetchLink ?? fetchLinkDoc;
  const timeoutMs = envMs("THREADS_REPLIES_LINK_TIMEOUT_MS", 25_000);
  const docs = await timed(
    trace,
    "links",
    async () => (await Promise.all(links.map((u) => fetch(u, { kind: "붙인 링크", idPrefix: "link", timeoutMs, signal: input.signal })))).filter((d): d is EvidenceDoc => !!d),
    (v) => v.length
  );
  return docs ?? [];
}

/** 박약사 질문 댓글의 근거. 붙인 링크 → 성분 페이지 → 팟캐스트 발언 순. */
export async function retrieveFromBrain(
  input: RetrieveInput,
  deps: BrainDeps = {}
): Promise<{ sources: AnswerSource[]; trace: RetrieveTrace }> {
  const trace: RetrieveTrace = [];
  const linksP = readLinks(input, deps, trace);
  const question = [input.reply.text, input.reply.repliedToText ?? ""].join(" ").trim();
  const found = await timed(trace, "brain", () => (deps.search ?? searchBrain)(question, MAX_PAGES + 2), (v) => v.pages.length, (v) => v.terms.join(", ") || "검색어 없음");
  const catalog = await timed(trace, "catalog", () => (deps.catalog ?? readCatalog)(), (v) => v.ingredients.length);
  const terms = [...new Set([...(found?.terms ?? []), ...queryTerms(input.reply.text)])];
  const links = await linksP;
  const sources = [
    ...links.map((d, i) => linkSource(d, terms, `s${i + 1}`)),
    ...brainSources(found?.pages ?? [], catalog, terms, CHOICE_Q.test(input.reply.text)).map((s, i) => ({ ...s, id: `s${links.length + i + 1}` })),
  ];
  trace.push({ stage: "rank", ms: 0, count: sources.length });
  return { sources, trace };
}
