// Threads Graph API 클라이언트 (graph.threads.net).
// 엔드포인트·필드는 실제 200 응답으로 확인한 것만 쓴다 — 추측 금지(CLAUDE.md ④).
//
// 확인된 사실 (2026-07-15 실측, @aicoffeechat 토큰):
//  - GET /me/threads 는 **루트 글만** 준다. 스레드의 2번째 이후 칸은 답글이라 안 온다.
//  - is_reply·root_post·replied_to·has_replies 필드와 /me/replies 엣지는
//    threads_read_replies 스코프가 없으면 "Application does not have permission".
//  - 인사이트는 글마다 API 1콜 (/{id}/insights?metric=views,likes,replies,reposts,quotes).
import { readStoredToken, writeStoredToken } from "./storage";
import { EMPTY_INSIGHTS, type ThreadsInsights } from "./model";

// 시험할 땐 가짜 스레드 서버(scripts/fake-threads.mjs)로 바꾼다.
export const THREADS_GRAPH_BASE = process.env.THREADS_GRAPH_BASE_URL ?? "https://graph.threads.net/v1.0";
const TOKEN_LIFETIME_MS = 60 * 24 * 60 * 60 * 1000; // 60일
const FETCH_TIMEOUT_MS = 30_000; // 외부 호출 하드 타임아웃(CLAUDE.md ④)

const POST_FIELDS =
  "id,text,permalink,timestamp,media_type,shortcode,is_quote_post,link_attachment_url";
const INSIGHT_METRICS = "views,likes,replies,reposts,quotes";

export class ThreadsGraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
    this.name = "ThreadsGraphError";
  }
}

/** 스코프 부족(권한 없음)인가 — 답글 칸을 건너뛸지 판정할 때 쓴다. */
export function isPermissionError(error: unknown): boolean {
  return (
    error instanceof ThreadsGraphError &&
    /does not have permission/i.test(error.body)
  );
}

/** 토큰 만료(OAuth 190)인가 — 갱신이 아니라 재인증이 필요한 상태. */
export function isTokenExpired(error: unknown): boolean {
  return (
    error instanceof ThreadsGraphError &&
    /session has expired|"code":\s*190/i.test(error.body)
  );
}

/** 레이트 리밋인가 — 만나면 모아둔 것만 저장하고 멈춘다. */
export function isRateLimited(error: unknown): boolean {
  if (!(error instanceof ThreadsGraphError)) return false;
  return error.status === 429 || /rate limit|too many/i.test(error.body);
}

export async function graphFetch(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) {
    throw new ThreadsGraphError(
      `Threads API ${res.status}`,
      res.status,
      text.slice(0, 500)
    );
  }
  return JSON.parse(text);
}

function withToken(path: string, token: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({ ...params, access_token: token });
  return `${THREADS_GRAPH_BASE}/${path}?${qs}`;
}

/**
 * 토큰 리졸브: data/threads-archive/token.json 우선, 없으면 .env.local 시드.
 * env 값이 저장된 씨앗과 다르면(새 토큰을 붙여넣은 경우) token.json 을 안 지워도 갈아탄다.
 */
export async function resolveAccessToken(): Promise<string> {
  const stored = await readStoredToken();
  const envToken = process.env.THREADS_ACCESS_TOKEN?.trim();
  if (stored && (!envToken || envToken === (stored.seedToken ?? stored.accessToken))) {
    return stored.accessToken;
  }
  if (!envToken) {
    throw new Error(
      "THREADS_ACCESS_TOKEN 이 .env.local 에 없습니다. 스레드 재인증이 필요해요."
    );
  }
  const now = new Date();
  await writeStoredToken({
    accessToken: envToken,
    seedToken: envToken,
    refreshedAt: now.toISOString(),
    // 씨앗 토큰의 실제 발급일을 모르므로 60일로 낙관한다. 갱신이 실패하면
    // 그때 만료로 드러나고, 성공하면 정확한 expires_in 으로 교정된다.
    expiresAt: new Date(now.getTime() + TOKEN_LIFETIME_MS).toISOString(),
  });
  return envToken;
}

/**
 * 마지막 갱신에서 24시간이 지났으면 갱신해 token.json 을 교체. 실패해도 기존 토큰으로 계속 간다.
 * 장기 토큰은 발급 24시간 이후 ~ 만료 전에 갱신하면 다시 60일 연장된다(공식 제약).
 *
 * expiresAt 을 조건에 쓰지 않는 이유(실사고 2026-08-13): 씨앗 토큰의 발급일을 모른 채
 * 60일로 낙관한 추정치라, 실제 만료(08-02)보다 늦게(09-13) 잡히면 "만료 7일 전" 갱신
 * 창이 영영 안 열리고 토큰이 죽는다. 갱신은 하루 1콜이라 매번 해도 싸다.
 */
export async function refreshTokenIfNeeded(nowMs = Date.now()): Promise<void> {
  const stored = await readStoredToken();
  if (!stored) return;
  if (nowMs - Date.parse(stored.refreshedAt) < 24 * 60 * 60 * 1000) return;
  try {
    const data = (await graphFetch(
      `${THREADS_GRAPH_BASE.replace(/\/v[\d.]+$/, "")}/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(
        stored.accessToken
      )}`
    )) as { access_token: string; expires_in: number };
    const now = new Date(nowMs);
    await writeStoredToken({
      ...stored,
      accessToken: data.access_token,
      refreshedAt: now.toISOString(),
      expiresAt: new Date(nowMs + data.expires_in * 1000).toISOString(),
    });
  } catch (error) {
    console.warn("[threads-archive] 토큰 갱신 실패, 기존 토큰으로 계속", error);
  }
}

export interface RawThreadsPost {
  id: string;
  text?: string;
  permalink?: string;
  timestamp?: string;
  media_type?: string;
  shortcode?: string;
  is_quote_post?: boolean;
  link_attachment_url?: string;
}

export async function fetchMe(token: string): Promise<{ id: string; username: string }> {
  return (await graphFetch(withToken("me", token, { fields: "id,username" }))) as {
    id: string;
    username: string;
  };
}

/**
 * 발행글 목록을 페이지네이션으로 가져온다 (API 가 최신순으로 준다 = 앞쪽이 최근).
 * limit 을 주면 그 개수를 채우는 즉시 멈춘다(페이지 단위라 조금 더 받고 자른다).
 */
export async function fetchAllPosts(
  token: string,
  opts: { limit?: number } = {}
): Promise<RawThreadsPost[]> {
  const out: RawThreadsPost[] = [];
  let url = withToken("me/threads", token, { fields: POST_FIELDS, limit: "100" });
  for (;;) {
    const page = (await graphFetch(url)) as {
      data?: RawThreadsPost[];
      paging?: { next?: string };
    };
    out.push(...(page.data ?? []));
    if (opts.limit && out.length >= opts.limit) break;
    const next = page.paging?.next;
    if (!next) break;
    url = next;
  }
  return opts.limit ? out.slice(0, opts.limit) : out;
}

function parseMetric(obj: Record<string, unknown>): number {
  const total = obj.total_value as { value?: number } | undefined;
  if (total && typeof total === "object" && typeof total.value === "number") {
    return total.value;
  }
  const values = obj.values as { value?: number }[] | undefined;
  if (Array.isArray(values) && values.length) return values[0]?.value ?? 0;
  return 0;
}

export async function fetchInsights(
  postId: string,
  token: string
): Promise<ThreadsInsights> {
  const data = (await graphFetch(
    withToken(`${postId}/insights`, token, { metric: INSIGHT_METRICS })
  )) as { data?: Record<string, unknown>[] };
  const out: ThreadsInsights = { ...EMPTY_INSIGHTS };
  for (const row of data.data ?? []) {
    const name = row.name as string;
    if (name in out) out[name as keyof ThreadsInsights] = parseMetric(row);
  }
  return out;
}

/**
 * 스레드의 2번째 이후 칸(내가 단 답글)을 순서대로 가져온다.
 * threads_read_replies 스코프가 없으면 null — "칸 없음"(빈 배열)과 구분한다.
 * conversation 엣지는 남의 답글까지 섞이므로 내 것만 골라낸다.
 */
export async function fetchOwnCards(
  postId: string,
  token: string,
  myUserId: string
): Promise<string[] | null> {
  try {
    const data = (await graphFetch(
      withToken(`${postId}/conversation`, token, {
        fields: "id,text,timestamp,username,owner,replied_to",
        limit: "50",
      })
    )) as {
      data?: {
        id: string;
        text?: string;
        timestamp?: string;
        owner?: { id?: string };
      }[];
    };
    const mine = (data.data ?? [])
      .filter((r) => r.owner?.id === myUserId && (r.text ?? "").trim())
      .sort((a, b) => Date.parse(a.timestamp ?? "") - Date.parse(b.timestamp ?? ""));
    return mine.map((r) => (r.text ?? "").trim());
  } catch (error) {
    if (isPermissionError(error)) return null;
    throw error;
  }
}

/**
 * 재인증 URL — 답글 칸까지 읽으려면 threads_read_replies 가 필요하고,
 * 대시보드에서 글을 올리려면 threads_content_publish, 남의 댓글에 답하려면
 * threads_manage_replies 가 필요하다.
 */
export const THREADS_APP_ID = "1640330907265066";
export const THREADS_REDIRECT_URI = "https://localhost/";
export const THREADS_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_insights",
  "threads_read_replies",
  // 남의 댓글에 답글 달기 (스레드 댓글 답하기, 09-27)
  "threads_manage_replies",
];

export function buildAuthUrl(): string {
  const qs = new URLSearchParams({
    client_id: THREADS_APP_ID,
    redirect_uri: THREADS_REDIRECT_URI,
    scope: THREADS_SCOPES.join(","),
    response_type: "code",
  });
  return `https://threads.net/oauth/authorize?${qs}`;
}
