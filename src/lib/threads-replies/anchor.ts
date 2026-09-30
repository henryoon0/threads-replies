// 1단계 "원글 원본" — 이 글을 쓸 때 쓴 재료를 찾는다 (2026-09-27).
//
// 댓글 질문 대부분은 글이 소개한 사례에 대한 것이라, 글의 재료(X 원문·답글)가 가장 정확한
// 근거다. 발행 글에는 어느 시안에서 왔는지 안 적혀 있으므로 시안↔발행 짝짓기
// (matchPublishedToDrafts, 글자 유사도)로 시안을 찾고, 시안의 variantGroup = link 잡 runId
// 로 data/threads-runs/<runId>/00_input/source.md·replies.md 를 읽는다.
//
// henry 는 발행 전에 첫 줄을 통째로 바꾸는 일이 많아 짝짓기 문턱(0.18)을 못 넘는 글이 있다
// (09-27 실측: 쇼릴 글 0.15, 칸 하나만 보면 0.58). 그래서 칸 단위 최대 유사도로 한 번 더
// 찾고, 그래도 없으면 글 시각 전후의 재료를 "후보 원본"으로 돌려 색인 한 장에 같이 올린다
// (모델이 제목을 보고 고른다).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { listIdeas, ideasVersion } from "@/lib/content-ideas";
import type { ContentIdea } from "@/lib/content-ideas-model";
import { matchPublishedToDrafts } from "@/lib/content-ideas-published-pairs";
import { textSimilarity } from "@/lib/content-ideas-style-eval";
import { localDateKey } from "@/lib/date";
import type { ThreadsPostRef } from "./model";
import type { EvidenceDoc } from "./evidence-index";

const PAIR_WINDOW_DAYS = 4;
const CARD_SIMILARITY_MIN = 0.4;
/** 후보 원본 창: 글보다 4일 전 ~ 1일 뒤에 만든 재료 */
const CANDIDATE_BEFORE_MS = 4 * 86_400_000;
const CANDIDATE_AFTER_MS = 1 * 86_400_000;
const MAX_CANDIDATE_GROUPS = 40;

function runsRoot(): string {
  return process.env.THREADS_RUNS_DIR || path.join(process.cwd(), "data", "threads-runs");
}

function toTime(iso: string | undefined): number {
  if (!iso) return NaN;
  return Date.parse(iso.replace(/\+0000$/, "+00:00"));
}

// ── pure ─────────────────────────────────────────────────────────

/** 시안 → link 잡 runId 후보 (variantGroup 우선, 없으면 카드 id 에서 벌 꼬리를 뗀 것). */
export function runIdCandidates(idea: Pick<ContentIdea, "id" | "variantGroup">): string[] {
  const out: string[] = [];
  if (idea.variantGroup) out.push(idea.variantGroup);
  const fromId = idea.id.replace(/^threads-run-/, "");
  if (fromId !== idea.id) {
    out.push(fromId);
    out.push(fromId.replace(/-[a-z]$/, ""));
  }
  return [...new Set(out)];
}

export interface RunSection {
  /** 0 = 단일 글, 1.. = 사례 모음의 사례 번호 */
  index: number;
  title: string;
  url?: string;
  text: string;
}

function headerValue(md: string, key: string): string {
  return md.match(new RegExp(`^- ${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
}

function firstBodyLine(md: string): string {
  const afterRule = md.split(/\n---\n/).slice(1).join("\n---\n");
  return (afterRule.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? "").slice(0, 80);
}

/**
 * source.md 를 근거 단위로 나눈다. 사례 모음("## 사례 N — …")은 사례마다 한 건 — 사례마다
 * 원문 링크가 달라 캡처·출처가 정확해진다. 일반 글은 파일 전체가 한 건.
 */
export function parseRunSource(md: string): RunSection[] {
  const caseRe = /^## 사례 (\d+) — (.+)$/gm;
  const heads = [...md.matchAll(caseRe)];
  if (heads.length === 0) {
    const author = headerValue(md, "작성자");
    const title = [author, firstBodyLine(md)].filter(Boolean).join(" · ") || "원문";
    return [{ index: 0, title, url: headerValue(md, "URL") || undefined, text: md }];
  }
  return heads.map((h, i) => {
    const start = h.index ?? 0;
    const end = heads[i + 1]?.index ?? md.length;
    const text = md.slice(start, end);
    const url = text.match(/^출처 URL:\s*(\S+)/m)?.[1] ?? (headerValue(text, "URL") || undefined);
    return { index: Number(h[1]), title: h[2].trim(), url, text };
  });
}

/** 발행 글 → 가장 닮은 시안. 전체 짝짓기가 실패하면 칸 단위 최대 유사도로 한 번 더. */
export function findSourceIdea(post: ThreadsPostRef, ideas: readonly ContentIdea[]): ContentIdea | null {
  const [pair] = matchPublishedToDrafts([post], [...ideas], { windowDays: PAIR_WINDOW_DAYS });
  if (pair) return ideas.find((i) => i.id === pair.ideaId) ?? null;
  const pAt = toTime(post.timestamp);
  if (!Number.isFinite(pAt)) return null;
  let best: { idea: ContentIdea; s: number } | null = null;
  for (const idea of ideas) {
    if (!idea.posts?.length) continue;
    if (Math.abs(toTime(idea.createdAt) - pAt) > PAIR_WINDOW_DAYS * 86_400_000) continue;
    const s = Math.max(...idea.posts.map((p) => textSimilarity(post.text, p)));
    if (s >= CARD_SIMILARITY_MIN && (!best || s > best.s)) best = { idea, s };
  }
  return best?.idea ?? null;
}

/** 글 시각 전후에 만든 재료 묶음 (variantGroup 별 대표 1장). 최신이 앞. */
export function candidateIdeas(post: ThreadsPostRef, ideas: readonly ContentIdea[]): ContentIdea[] {
  const pAt = toTime(post.timestamp);
  if (!Number.isFinite(pAt)) return [];
  const byGroup = new Map<string, ContentIdea>();
  for (const idea of ideas) {
    const at = toTime(idea.createdAt);
    if (!(at >= pAt - CANDIDATE_BEFORE_MS && at <= pAt + CANDIDATE_AFTER_MS)) continue;
    const key = idea.variantGroup || idea.id;
    if (!byGroup.has(key)) byGroup.set(key, idea);
  }
  return [...byGroup.values()]
    .sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt))
    .slice(0, MAX_CANDIDATE_GROUPS);
}

/** 잡 폴더가 없는 시안(큐레이션 카드 등)은 카드에 남은 원문 인용·팩트체크로 근거를 만든다. */
export function ideaFallbackDoc(idea: ContentIdea): EvidenceDoc | null {
  const facts = (idea.factChecks ?? []).map((f) => `- ${f.claim} — ${f.basis} (${f.source})`);
  const text = [idea.sourceQuote, idea.sourceNote, ...facts].filter((s) => s && s.trim()).join("\n");
  if (!text.trim()) return null;
  const url = (idea.postSources ?? []).find(Boolean);
  return {
    id: `idea:${idea.id}`,
    kind: "원글 원본",
    title: idea.posts?.[0]?.split("\n")[0]?.slice(0, 80) || idea.id,
    text,
    url,
    origin: `content-ideas ${idea.id}`,
    date: dateOf(idea.createdAt),
  };
}

function dateOf(iso: string | undefined): string {
  const t = toTime(iso);
  return Number.isFinite(t) ? localDateKey(new Date(t)) : "";
}

// ── I/O ──────────────────────────────────────────────────────────

let ideasMemo: { version: string; ideas: ContentIdea[] } | null = null;

/** content-ideas.json 은 21MB — 파일 버전(mtime+size)이 같으면 다시 안 읽는다. */
export async function cachedIdeas(): Promise<ContentIdea[]> {
  const version = await ideasVersion();
  if (ideasMemo && ideasMemo.version === version) return ideasMemo.ideas;
  const ideas = await listIdeas();
  ideasMemo = { version, ideas };
  return ideas;
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf-8");
  } catch {
    return null;
  }
}

/** 시안 하나 → 원글 원본 문서들 (source.md 사례별 + replies.md). */
export async function docsForIdea(idea: ContentIdea): Promise<EvidenceDoc[]> {
  for (const runId of runIdCandidates(idea)) {
    const dir = path.join(runsRoot(), runId, "00_input");
    const source = await readIfExists(path.join(dir, "source.md"));
    if (!source) continue;
    const date = dateOf(idea.createdAt);
    const hook = idea.posts?.[0]?.split("\n")[0]?.trim();
    const docs: EvidenceDoc[] = parseRunSource(source).map((s) => ({
      id: `run:${runId}#${s.index}`,
      kind: "원글 원본",
      title: s.title,
      text: s.text,
      url: s.url,
      origin: `threads-runs/${runId}/00_input/source.md${s.index ? ` (사례 ${s.index})` : ""}`,
      date,
      aliases: hook ? [hook] : undefined,
    }));
    const replies = await readIfExists(path.join(dir, "replies.md"));
    if (replies && replies.trim().length > 40) {
      docs.push({
        id: `run:${runId}#replies`,
        kind: "원글 원본",
        title: `${docs[0]?.title ?? runId} · 원문에 달린 답글`,
        text: replies,
        url: docs[0]?.url,
        origin: `threads-runs/${runId}/00_input/replies.md`,
        date,
      });
    }
    return docs;
  }
  const fb = ideaFallbackDoc(idea);
  return fb ? [fb] : [];
}

export interface AnchorResult {
  /** 짝이 확실한 원글 원본 (1단계 결과) */
  anchors: EvidenceDoc[];
  /** 짝을 못 찾았을 때 색인 한 장에 같이 올릴 후보 원본 */
  candidates: EvidenceDoc[];
  ideaId?: string;
}

/** 글 → 원글 원본. 짝이 없으면 시각 전후 후보를 돌려준다. */
export async function findAnchors(post: ThreadsPostRef): Promise<AnchorResult> {
  const ideas = await cachedIdeas();
  const idea = findSourceIdea(post, ideas);
  if (idea) {
    const anchors = await docsForIdea(idea);
    if (anchors.length) return { anchors, candidates: [], ideaId: idea.id };
  }
  const candidates: EvidenceDoc[] = [];
  for (const c of candidateIdeas(post, ideas)) {
    // 후보는 원문 본문만 (답글 모음은 짝이 확정된 뒤에만 쓴다)
    candidates.push(...(await docsForIdea(c)).filter((d) => !d.id.endsWith("#replies")));
  }
  return { anchors: [], candidates };
}
