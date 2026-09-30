// 시안 ↔ 실제 발행 글 짝짓기 (2026-08-31).
//
// 왜: 학습 루프(content-ideas-lessons)의 연료가 "henry가 피드백을 글로 써준 것"
// 뿐이라 말라 있었다 (실측: 시안 1,126편 중 교정 기록이 남은 건 20편, 마지막 신호가
// 08-15). 반면 henry 는 매일 글을 발행하고, 그 발행본은 시안을 고쳐서 올린 결과다 —
// 아무 말을 안 해도 쌓이는 정답지다. 시안과 발행본을 나란히 놓으면 "무엇을 어떻게
// 고쳤나"가 그대로 나온다 (08-29 Buehler 건 실측: 한 짝에서 규칙 후보 6개).
//
// 짝짓기는 소재 링크가 아니라 글자 유사도로 한다. 발행본에는 어느 시안에서 왔는지가
// 안 적혀 있고, henry 가 첫 줄을 통째로 바꿔 올려도 소재의 고유명사·수치가 남기
// 때문이다. Pure + tested — I/O 는 호출처가 한다.
import { textSimilarity } from "@/lib/content-ideas-style-eval";
import type { ContentIdea } from "@/lib/content-ideas-model";

/** 발행 글 쪽 입력. threads-archive 의 ArchivedPost 에서 필요한 것만 받는다. */
export interface PublishedPostLike {
  id: string;
  text: string;
  timestamp: string;
  permalink?: string;
}

export interface PublishedPair {
  postId: string;
  publishedAt: string;
  publishedText: string;
  permalink?: string;
  ideaId: string;
  /** 시안의 1칸 — 발행본의 첫 문단과 대조할 자리다. */
  draftFirstPost: string;
  draftCreatedAt: string;
  similarity: number;
}

// 창(window)과 문턱은 2026-08-31 실측으로 정했다: 최근 발행 12편 × 시안 1,126편에서
// ±3일·0.18 이면 4편이 짝을 찾고 오탐은 0이었다 (짝을 못 찾은 8편은 대시보드를 안
// 거친 짧은 공지라 원래 시안이 없다). 문턱을 더 낮추면 같은 날 만든 다른 소재의
// 시안이 딸려 들어온다.
const DEFAULT_WINDOW_DAYS = 3;
const DEFAULT_MIN_SIMILARITY = 0.18;
// 시안은 길고(3~4천 자) 발행본은 짧다(중앙값 208자). 전문끼리 재면 길이 차이만으로
// 유사도가 깎이므로, 시안은 앞 2칸까지만 비교 재료로 쓴다.
const DRAFT_COMPARE_POSTS = 2;

function toTime(iso: string | undefined): number {
  if (!iso) return NaN;
  const t = Date.parse(iso.replace(/\+0000$/, "+00:00"));
  return Number.isFinite(t) ? t : NaN;
}

function compareText(posts: string[]): string {
  return posts.slice(0, DRAFT_COMPARE_POSTS).join(" ");
}

/**
 * 발행 글마다 가장 닮은 시안 하나를 찾는다. 시안 하나가 두 발행 글에 붙지 않게
 * 1:1 로 잠근다 (유사도가 높은 짝부터 가져간다).
 *
 * `sinceISO` 를 주면 그 이후에 발행된 글만 본다 — 학습 루프가 이미 소화한 구간을
 * 다시 먹지 않게 하는 창이다.
 */
export function matchPublishedToDrafts(
  published: PublishedPostLike[],
  ideas: ContentIdea[],
  opts: { windowDays?: number; minSimilarity?: number; sinceISO?: string } = {}
): PublishedPair[] {
  const windowMs = (opts.windowDays ?? DEFAULT_WINDOW_DAYS) * 86_400_000;
  const minSim = opts.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const sinceMs = opts.sinceISO ? toTime(opts.sinceISO) : NaN;

  const drafts = ideas
    .filter((i) => Array.isArray(i.posts) && i.posts.length > 0 && i.createdAt)
    .map((i) => ({ idea: i, at: toTime(i.createdAt), text: compareText(i.posts) }))
    .filter((d) => Number.isFinite(d.at));

  // 후보 전부를 모아 유사도 내림차순으로 배정한다. 발행 글 순서대로 그리디하게
  // 집으면 앞 글이 뒷 글의 진짜 짝을 채가는 일이 생긴다.
  const candidates: PublishedPair[] = [];
  for (const post of published) {
    const pAt = toTime(post.timestamp);
    if (!Number.isFinite(pAt)) continue;
    if (Number.isFinite(sinceMs) && pAt < sinceMs) continue;
    for (const d of drafts) {
      if (Math.abs(d.at - pAt) > windowMs) continue;
      const similarity = textSimilarity(post.text, d.text);
      if (similarity < minSim) continue;
      candidates.push({
        postId: post.id,
        publishedAt: post.timestamp,
        publishedText: post.text,
        ...(post.permalink ? { permalink: post.permalink } : {}),
        ideaId: d.idea.id,
        draftFirstPost: d.idea.posts[0] ?? "",
        draftCreatedAt: d.idea.createdAt ?? "",
        similarity,
      });
    }
  }
  candidates.sort((a, b) => b.similarity - a.similarity);

  const usedPosts = new Set<string>();
  const usedIdeas = new Set<string>();
  const pairs: PublishedPair[] = [];
  for (const c of candidates) {
    if (usedPosts.has(c.postId) || usedIdeas.has(c.ideaId)) continue;
    usedPosts.add(c.postId);
    usedIdeas.add(c.ideaId);
    pairs.push(c);
  }
  // 최신 발행이 앞에 오게 — 학습 루프가 새 신호를 먼저 읽는다.
  pairs.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  return pairs;
}
