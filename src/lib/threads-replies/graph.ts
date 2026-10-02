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
import { readFile } from "fs/promises";
import { currentPersona } from "@/lib/personas/context";
import { DEFAULT_PERSONA_ID } from "@/lib/personas/model";
import { personaTokenPath } from "@/lib/personas/registry";
import { envMs } from "./storage";

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
// 10쪽(1,000건)이면 댓글 1,200개 넘는 글에서 가장 오래된 댓글·내 답이 잘려 "안 답함"으로 남았다 (10-02 실측 1,237건·13쪽).
const MAX_CONVERSATION_PAGES = 50;

const POST_FIELDS = "id,text,timestamp,permalink";
const CONVERSATION_FIELDS = "id,text,username,timestamp,permalink,replied_to,is_reply_owned_by_me,has_replies";

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
  permalink?: string;
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

/**
 * 갱신을 한 번 시도한 뒤 쓸 토큰. AICC 는 기존 threads-archive 토큰(.env.local + token.json),
 * 다른 페르소나는 팩 private/token.json 의 accessToken 을 쓴다 (갱신은 아직 AICC 만).
 */
export async function readyToken(): Promise<string> {
  const persona = currentPersona();
  if (persona.id !== DEFAULT_PERSONA_ID) return readPersonaToken(persona.id);
  await refreshTokenIfNeeded();
  return resolveAccessToken();
}

async function readPersonaToken(id: string): Promise<string> {
  try {
    const raw = JSON.parse(await readFile(personaTokenPath(id), "utf8")) as { accessToken?: unknown };
    if (typeof raw.accessToken === "string" && raw.accessToken.trim()) return raw.accessToken.trim();
  } catch {
    // 아래에서 안내
  }
  throw new ThreadsGraphError(`${id} 팩에 스레드 토큰이 없어요 (private/token.json)`, 401, "");
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

const MY_REPLY_FIELDS = "id,text,timestamp,permalink,replied_to,root_post";

export interface RawMyReply {
  id: string;
  text?: string;
  timestamp?: string;
  permalink?: string;
  replied_to?: { id?: string };
  root_post?: { id?: string };
}

/**
 * 내가 단 답글 전부 (최신순). 남의 글에 단 답 + 내 글에 이어 쓴 연재 본문이 같이 온다.
 * 실측 (2026-09-28): GET /me/replies 200, replied_to·root_post 는 id 만 준다.
 * stopAtId 를 만나면 멈춘다 (이미 받아 둔 곳부터는 다시 받지 않는다).
 */
export async function listMyReplies(max: number, stopAtId?: string, token?: string): Promise<RawMyReply[]> {
  const t = token ?? (await readyToken());
  const out: RawMyReply[] = [];
  let url: string | undefined = buildUrl("me/replies", t, { fields: MY_REPLY_FIELDS, limit: "100" });
  while (url && out.length < max) {
    const page: Page<RawMyReply> = await fetchJson<Page<RawMyReply>>(url);
    for (const r of page.data ?? []) {
      if (r.id === stopAtId) return out;
      out.push(r);
    }
    url = page.paging?.next;
  }
  return out.slice(0, max);
}
