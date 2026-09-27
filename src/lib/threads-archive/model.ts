// 스레드 성과 보관함 — 순수 모델/계산. 파일·네트워크 의존 없음(테스트 쉬움).
//
// 이 도메인은 "발행된 내 글 + 실제 반응"을 다룬다. 초안 파이프라인
// (content-ideas-*, threads-runs)은 발행 전이라 별개다. 여기 있는 글은
// henry 가 직접 손봐서 올린 최종본이라, 재활용(카톡·링크드인)과
// few-shot 후보 풀의 원천이 된다.

export interface ThreadsInsights {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
}

export const EMPTY_INSIGHTS: ThreadsInsights = {
  views: 0,
  likes: 0,
  replies: 0,
  reposts: 0,
  quotes: 0,
};

export interface ArchivedPost {
  /** Threads 미디어 id (숫자 문자열). dirStore 파일명이 된다. */
  id: string;
  shortcode?: string;
  permalink: string;
  /** 루트 칸 본문. */
  text: string;
  /** API 가 주는 발행 시각(UTC ISO). */
  timestamp: string;
  mediaType?: string;
  linkAttachmentUrl?: string;
  isQuotePost?: boolean;
  insights: ThreadsInsights;
  /**
   * 2번째 이후 칸(답글로 달린 본문). threads_read_replies 스코프가 있어야 채워진다.
   * 스코프가 없으면 undefined — "칸이 없다"가 아니라 "못 읽었다"는 뜻이므로
   * 빈 배열과 구분한다.
   */
  cards?: string[];
  /** 인사이트를 마지막으로 새로 읽은 시각. 새로고침 주기 판정 기준. */
  insightsSyncedAt?: string;
  syncedAt: string;
}

/**
 * 반응 점수 — 무게는 "그 행동을 하기까지의 품이 얼마나 드는가" 순.
 * 좋아요(1) < 답글(2) < 리포스트·인용(3). 조회는 도달일 뿐이라 0.
 * fetch_threads.py 가 쓰던 값 그대로 옮겼다(점수 연속성 유지).
 */
export const SCORE_WEIGHTS: Record<keyof ThreadsInsights, number> = {
  likes: 1,
  replies: 2,
  reposts: 3,
  quotes: 3,
  views: 0,
};

export function scoreOf(insights: ThreadsInsights): number {
  let total = 0;
  for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) {
    total += (insights[key as keyof ThreadsInsights] || 0) * weight;
  }
  return total;
}

/**
 * 반응률 = 반응 점수 / 조회수. 도달이 다른 글끼리 비교할 때 쓴다.
 * 조회 16.9만에 좋아요 3,266(1.9%)보다, 조회 5천에 좋아요 300(6%)이
 * "글 자체"는 더 잘 먹힌 것이므로 raw 점수만으로 줄 세우면 오해한다.
 * 조회가 0이면(집계 전) 0 — 0으로 나눠서 Infinity 를 만들지 않는다.
 */
export function engagementRateOf(insights: ThreadsInsights): number {
  if (!insights.views) return 0;
  return scoreOf(insights) / insights.views;
}

/** 루트 칸 + 답글 칸을 이어붙인 전문. 재활용(카톡·링크드인)이 먹는 원문. */
export function fullTextOf(post: Pick<ArchivedPost, "text" | "cards">): string {
  const cards = post.cards ?? [];
  return [post.text, ...cards].filter((s) => s.trim()).join("\n\n");
}

export type SortKey = "score" | "likes" | "views" | "rate" | "recent";

export function sortPosts(posts: ArchivedPost[], key: SortKey): ArchivedPost[] {
  const by: Record<SortKey, (p: ArchivedPost) => number> = {
    score: (p) => scoreOf(p.insights),
    likes: (p) => p.insights.likes,
    views: (p) => p.insights.views,
    rate: (p) => engagementRateOf(p.insights),
    recent: (p) => Date.parse(p.timestamp) || 0,
  };
  const pick = by[key] ?? by.score;
  return [...posts].sort((a, b) => pick(b) - pick(a));
}

/**
 * 인사이트를 다시 읽어야 하는가.
 * 발행 직후 숫자는 계속 자라고, 2주쯤 지나면 사실상 멈춘다. 글마다 API 1콜이라
 * 전부 매번 새로 읽으면 레이트 리밋을 태운다 → 최근 글만 갱신한다.
 */
export const FRESH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function needsInsightRefresh(
  post: ArchivedPost | null,
  nowMs: number,
  freshWindowMs: number = FRESH_WINDOW_MS
): boolean {
  if (!post) return true; // 처음 보는 글
  if (!post.insightsSyncedAt) return true;
  const publishedMs = Date.parse(post.timestamp);
  if (!Number.isFinite(publishedMs)) return true;
  // 발행 2주가 지난 글은 이미 읽어둔 숫자를 믿는다.
  return nowMs - publishedMs < freshWindowMs;
}

export type SyncState = "idle" | "syncing" | "failed";

export interface ThreadsSyncJob {
  state: SyncState;
  /** 고아 판정의 하트비트. 진행 중엔 배치마다 갱신된다. */
  updatedAt: string;
  startedAt?: string;
  error?: string;
  /** 마지막으로 끝까지 성공한 시각. */
  lastSyncedAt?: string;
  /** 레이트 리밋에 걸려 일부만 모은 채 끝난 회차. 다시 돌리면 이어받는다. */
  partial?: boolean;
  /** 답글 칸을 읽을 스코프가 없어 루트 칸만 모았는가. 재인증 안내의 근거. */
  cardsBlocked?: boolean;
  progress?: {
    posts: number;
    insights: number;
  };
}

export function isActiveState(state: SyncState): boolean {
  return state === "syncing";
}
