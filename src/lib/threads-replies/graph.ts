// 스레드 댓글 읽기 전용 Graph 호출. 토큰 리졸브·갱신·오류 모양은 threads-archive/graph.ts 를 그대로 쓴다.
// 실측 (2026-09-27, @aicoffeechat):
//  - GET /me/threads?fields=id,text,timestamp,permalink → 루트 글, 최신순
//  - GET /{postId}/conversation?fields=id,text,username,timestamp,replied_to,is_reply_owned_by_me,has_replies
//    → 대화 트리 전체 (내 답글 포함, 평평한 목록)
import {
  THREADS_GRAPH_BASE,
  ThreadsGraphError,
  refreshTokenIfNeeded,
  resolveAccessToken,
} from "@/lib/threads-archive/graph";
import { envMs } from "./storage";

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const MAX_CONVERSATION_PAGES = 10;

const POST_FIELDS = "id,text,timestamp,permalink";
const CONVERSATION_FIELDS = "id,text,username,timestamp,replied_to,is_reply_owned_by_me,has_replies";

export interface RawPost {
  id: string;
  text?: string;
  timestamp?: string;
  permalink?: string;
}

export interface RawConversationReply {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  replied_to?: { id?: string };
  is_reply_owned_by_me?: boolean;
  has_replies?: boolean;
}

interface Page<T> {
  data?: T[];
  paging?: { next?: string };
}

async function fetchJson<T>(url: string): Promise<T> {
  const timeoutMs = envMs("THREADS_REPLIES_FETCH_TIMEOUT_MS", DEFAULT_FETCH_TIMEOUT_MS);
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new ThreadsGraphError(`Threads API ${res.status}`, res.status, text.slice(0, 500));
  return JSON.parse(text) as T;
}

function buildUrl(pathName: string, token: string, params: Record<string, string>): string {
  const qs = new URLSearchParams({ ...params, access_token: token });
  return `${THREADS_GRAPH_BASE}/${pathName}?${qs}`;
}

/** 갱신을 한 번 시도한 뒤 쓸 토큰. */
export async function readyToken(): Promise<string> {
  await refreshTokenIfNeeded();
  return resolveAccessToken();
}

/** 최근 루트 글 limit 개 (최신순). */
export async function listRecentPosts(limit: number, token?: string): Promise<RawPost[]> {
  const t = token ?? (await readyToken());
  const out: RawPost[] = [];
  let url: string | undefined = buildUrl("me/threads", t, { fields: POST_FIELDS, limit: String(Math.min(limit, 100)) });
  while (url && out.length < limit) {
    const page: Page<RawPost> = await fetchJson<Page<RawPost>>(url);
    out.push(...(page.data ?? []));
    url = page.paging?.next;
  }
  return out.slice(0, limit);
}

/** 글 하나의 대화 트리 전체 (평평한 목록, 페이지 끝까지). */
export async function fetchConversation(postId: string, token?: string): Promise<RawConversationReply[]> {
  const t = token ?? (await readyToken());
  const out: RawConversationReply[] = [];
  let url: string | undefined = buildUrl(`${postId}/conversation`, t, { fields: CONVERSATION_FIELDS, limit: "100" });
  for (let i = 0; url && i < MAX_CONVERSATION_PAGES; i++) {
    const page: Page<RawConversationReply> = await fetchJson<Page<RawConversationReply>>(url);
    out.push(...(page.data ?? []));
    url = page.paging?.next;
  }
  return out;
}
