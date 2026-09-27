// 발행글 동기화 러너 (CLAUDE.md ④ fire-and-forget 3종 세트):
//  ① 고아 자동 재개 — GET 폴링의 resumeOrphan + 부팅 sweep(sweep.ts)
//  ② 부분 저장 — 글 하나 처리할 때마다 즉시 디스크에 쓴다. 중간에 죽어도 진행분이 남고,
//     다음 회차가 캐시된 인사이트를 건너뛰며 이어받는다.
//  ③ 하드 타임아웃 — graph.ts 의 fetch 마다 30초 AbortSignal.timeout
//
// runSync 는 절대 reject 하지 않는다 — 호출처가 `void` 로 띄우므로 reject 가 새면
// 프로세스가 죽는다.
import {
  fetchAllPosts,
  fetchInsights,
  fetchMe,
  fetchOwnCards,
  isRateLimited,
  isTokenExpired,
  ThreadsGraphError,
  refreshTokenIfNeeded,
  resolveAccessToken,
  type RawThreadsPost,
} from "./graph";
import { EMPTY_INSIGHTS, needsInsightRefresh, type ArchivedPost } from "./model";
import { isOrphan } from "./orphan";
import { patchJob, readJob, readPost, writePost } from "./storage";

/** 인용 재게시는 남의 글이라 내 보이스 표본이 아니다 — 보관함에서 뺀다. */
function isArchivable(raw: RawThreadsPost): boolean {
  return Boolean(raw.text?.trim()) && !raw.is_quote_post;
}

/**
 * 최근 몇 개까지 볼 것인가.
 * 실측(2026-07-15): @aicoffeechat 계정에 글이 2,413개 있고, 인사이트는 글마다 API 1콜이라
 * 전부 받으면 2,400콜에 ~30분이 걸린다. 최근 500개면 1년치가 넘고(월 ~40개 발행)
 * 역대 최고 반응 글도 그 안에 든다. 더 캐야 하면 THREADS_ARCHIVE_LIMIT 을 올린다(0 = 전체).
 */
function syncLimit(): number | undefined {
  const raw = process.env.THREADS_ARCHIVE_LIMIT;
  if (raw === undefined) return 500;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined; // 0 = 제한 없음
  return n;
}

/**
 * 실행 중 표시는 globalThis 에 둔다 — dev 에서 Turbopack 이 모듈을 다시 인스턴스화하면
 * 모듈 지역 변수는 false 로 초기화되고, 그 순간 부팅 sweep(active = 고아로 간주)이
 * 이미 도는 동기화를 한 번 더 띄운다. 실측으로 잡이 2개 겹쳐 돌았다(2026-07-15).
 */
const guard = globalThis as typeof globalThis & { __threadsArchiveSyncing?: boolean };

export function isSyncing(): boolean {
  return guard.__threadsArchiveSyncing === true;
}

async function syncOnce(nowMs: number): Promise<void> {
  await refreshTokenIfNeeded(nowMs);
  const token = await resolveAccessToken();
  const me = await fetchMe(token);

  // 목록 페이지네이션은 100개당 1콜로 싸다. 비싼 건 아래 글별 인사이트 콜.
  const raws = await fetchAllPosts(token, { limit: syncLimit() });
  const posts = raws.filter(isArchivable);
  await patchJob({ progress: { posts: posts.length, insights: 0 } });

  let insightCalls = 0;
  let rateLimited = false;
  // 스코프가 없으면 글마다 헛 호출을 하게 되므로, 한 번 막히면 이번 회차는 접는다.
  let cardsBlocked = false;

  for (const raw of posts) {
    const existing = await readPost(raw.id);
    let insights = existing?.insights ?? { ...EMPTY_INSIGHTS };
    let insightsSyncedAt = existing?.insightsSyncedAt;

    if (needsInsightRefresh(existing, nowMs)) {
      try {
        insights = await fetchInsights(raw.id, token);
        insightsSyncedAt = new Date().toISOString();
        insightCalls += 1;
      } catch (error) {
        if (isRateLimited(error)) {
          rateLimited = true;
          break; // 모아둔 건 이미 디스크에 있다. 다음 회차가 이어받는다.
        }
        // 글 하나의 인사이트 실패는 그 글만 0으로 두고 넘어간다.
        console.warn(`[threads-archive] 인사이트 실패 ${raw.id}`, error);
      }
    }

    // 칸은 한 번 올라가면 안 바뀐다 → 이미 읽었으면 다시 안 읽는다.
    let cards = existing?.cards;
    if (cards === undefined && !cardsBlocked) {
      try {
        const fetched = await fetchOwnCards(raw.id, token, me.id);
        if (fetched === null) {
          cardsBlocked = true; // 스코프 없음 — 이번 회차 내내 건너뛴다.
        } else {
          // 첫 항목은 루트 글 자신일 수 있다(conversation 은 루트를 포함하기도 함).
          cards = fetched.filter((t) => t !== raw.text?.trim());
        }
      } catch (error) {
        if (isRateLimited(error)) {
          rateLimited = true;
          break;
        }
        console.warn(`[threads-archive] 칸 읽기 실패 ${raw.id}`, error);
      }
    }

    const post: ArchivedPost = {
      id: raw.id,
      shortcode: raw.shortcode,
      permalink: raw.permalink ?? "",
      text: raw.text?.trim() ?? "",
      timestamp: raw.timestamp ?? new Date(nowMs).toISOString(),
      mediaType: raw.media_type,
      linkAttachmentUrl: raw.link_attachment_url,
      isQuotePost: raw.is_quote_post,
      insights,
      cards,
      insightsSyncedAt,
      syncedAt: new Date().toISOString(),
    };
    await writePost(post); // ② 글마다 즉시 저장
    await patchJob({ progress: { posts: posts.length, insights: insightCalls } });
  }

  await patchJob({
    state: "idle",
    error: undefined,
    lastSyncedAt: new Date().toISOString(),
    partial: rateLimited,
    cardsBlocked,
    progress: { posts: posts.length, insights: insightCalls },
  });
}

/** 동기화 시작. 중복 실행은 조용히 무시한다. 절대 throw 하지 않는다. */
export async function runSync(nowMs: number = Date.now()): Promise<void> {
  if (guard.__threadsArchiveSyncing) return;
  guard.__threadsArchiveSyncing = true;
  try {
    await patchJob({
      state: "syncing",
      startedAt: new Date(nowMs).toISOString(),
      error: undefined,
      partial: false,
    });
    await syncOnce(nowMs);
  } catch (error) {
    // "Threads API 400" 만 남기면 원인을 알 수 없다 — 응답 본문까지 붙여 저장한다.
    let message = error instanceof Error ? error.message : String(error);
    if (isTokenExpired(error)) {
      message =
        "스레드 토큰 만료 — 재인증 후 새 토큰을 .env.local THREADS_ACCESS_TOKEN 에 넣어주세요";
    } else if (error instanceof ThreadsGraphError && error.body) {
      message = `${message}: ${error.body.slice(0, 200)}`;
    }
    try {
      await patchJob({ state: "failed", error: message });
    } catch (settleError) {
      // 디스크 쓰기 실패까지 삼킨다 — 여기서 throw 하면 프로세스가 죽는다.
      console.warn("[threads-archive] 잡 상태 저장 실패", settleError);
    }
  } finally {
    guard.__threadsArchiveSyncing = false;
  }
}

export function startSync(): void {
  void runSync();
}

/** 고아(재시작으로 끊긴 syncing)를 재개. 멱등 — 이미 돌고 있으면 runSync 가 무시한다. */
export async function resumeOrphan(nowMs: number = Date.now()): Promise<boolean> {
  const job = await readJob();
  if (!isOrphan(job, nowMs)) return false;
  void runSync();
  return true;
}
