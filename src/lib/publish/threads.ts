// ── 스레드 자동 게시 ─────────────────────────────────────────────────────────
//
// 공식 계약(2026-08-15 developers.facebook.com 확인):
//   1) 컨테이너 만들기  POST /v1.0/me/threads
//        media_type=TEXT|IMAGE, text, image_url, reply_to_id, access_token
//   영상은 이 경로로 올리지 않는다 (henry 확정 2026-08-18: 자동 발행이 아니라
//   자동 채움까지만) — 영상 칸이 있는 스레드는 발행 준비에서 막고 확장으로 넘긴다.
//   2) 상태 확인        GET  /v1.0/{container-id}?fields=status,error_message
//        status: IN_PROGRESS | FINISHED | ERROR | EXPIRED | PUBLISHED
//   3) 발행            POST /v1.0/me/threads_publish  creation_id
//   컨테이너는 24시간 뒤 만료, 계정당 24시간에 250건.
//
// 칸을 이어 붙이는 방법은 reply_to_id 다. 앞 칸을 "발행한 뒤" 받은 게시물 id 를
// 다음 칸의 reply_to_id 로 준다 (컨테이너 id 가 아니다 — 아직 글이 아니라서).

import { setTimeout as sleep } from "node:timers/promises";

// 시험할 땐 가짜 스레드 서버(scripts/fake-threads.mjs)로 바꾼다.
export const THREADS_GRAPH_BASE = process.env.THREADS_GRAPH_BASE_URL ?? "https://graph.threads.net/v1.0";

/** 이미지 처리를 기다리는 상한. 텍스트 칸은 보통 1~2초면 FINISHED 다. */
const CONTAINER_READY_TIMEOUT_MS = 120_000;
const CONTAINER_POLL_MS = 2_000;
const FETCH_TIMEOUT_MS = 30_000;

export class ThreadsPublishError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    /** 사람이 손봐야 푸는 문제인지(토큰·권한) 여부. 재시도해도 소용없다. */
    readonly fatal = false
  ) {
    super(message);
    this.name = "ThreadsPublishError";
  }
}

type Json = Record<string, unknown>;

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return text.slice(0, 500);
}

function describe(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; error_user_msg?: string } };
    return parsed.error?.error_user_msg ?? parsed.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/** 토큰 만료·권한 부족은 재시도 대상이 아니다 (OAuth 190 / 10 / 200). */
function isFatal(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true;
  try {
    const parsed = JSON.parse(body) as { error?: { code?: number; type?: string } };
    const code = parsed.error?.code;
    return code === 190 || code === 10 || code === 200 || parsed.error?.type === "OAuthException";
  } catch {
    return false;
  }
}

async function threadsPost(path: string, params: Record<string, string>): Promise<Json> {
  const res = await fetch(`${THREADS_GRAPH_BASE}/${path}`, {
    method: "POST",
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await readError(res);
    throw new ThreadsPublishError(
      describe(body, `스레드 요청 실패 (HTTP ${res.status})`),
      res.status,
      body,
      isFatal(res.status, body)
    );
  }
  return (await res.json()) as Json;
}

async function threadsGet(path: string, params: Record<string, string>): Promise<Json> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${THREADS_GRAPH_BASE}/${path}?${qs}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await readError(res);
    throw new ThreadsPublishError(
      describe(body, `스레드 조회 실패 (HTTP ${res.status})`),
      res.status,
      body,
      isFatal(res.status, body)
    );
  }
  return (await res.json()) as Json;
}

export type ThreadsSlotInput = {
  readonly text: string;
  /** 공개적으로 열리는 https URL 이어야 한다. localhost 파일은 못 쓴다. */
  readonly imageUrl?: string;
};

export async function createThreadsContainer(
  token: string,
  slot: ThreadsSlotInput,
  replyToId?: string
): Promise<string> {
  const params: Record<string, string> = {
    media_type: slot.imageUrl ? "IMAGE" : "TEXT",
    text: slot.text,
    access_token: token,
  };
  if (slot.imageUrl) params.image_url = slot.imageUrl;
  if (replyToId) params.reply_to_id = replyToId;

  const data = await threadsPost("me/threads", params);
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) {
    throw new ThreadsPublishError("스레드가 컨테이너 id 를 안 줬어요", 502, JSON.stringify(data));
  }
  return id;
}

/** FINISHED 가 될 때까지 기다린다. ERROR·EXPIRED 는 즉시 실패로 끊는다. */
export async function waitForContainer(
  token: string,
  containerId: string,
  { timeoutMs = CONTAINER_READY_TIMEOUT_MS, pollMs = CONTAINER_POLL_MS } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const data = await threadsGet(containerId, {
      fields: "status,error_message",
      access_token: token,
    });
    const status = typeof data.status === "string" ? data.status : "";
    if (status === "FINISHED" || status === "PUBLISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      const detail = typeof data.error_message === "string" ? data.error_message : status;
      throw new ThreadsPublishError(`스레드가 이 칸을 준비하지 못했어요: ${detail}`, 502, JSON.stringify(data));
    }
    if (Date.now() >= deadline) {
      throw new ThreadsPublishError(
        `스레드 칸 준비가 ${Math.round(timeoutMs / 1000)}초를 넘겼어요 (마지막 상태: ${status || "알 수 없음"})`,
        504,
        JSON.stringify(data)
      );
    }
    await sleep(pollMs);
  }
}

export async function publishThreadsContainer(token: string, creationId: string): Promise<string> {
  const data = await threadsPost("me/threads_publish", {
    creation_id: creationId,
    access_token: token,
  });
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) {
    throw new ThreadsPublishError("스레드가 게시물 id 를 안 줬어요", 502, JSON.stringify(data));
  }
  return id;
}

export type ThreadsSlotResult = {
  readonly index: number;
  readonly postId: string;
};

/**
 * 칸을 순서대로 올린다. 이미 올라간 칸은 `already` 로 넘겨받아 건너뛰므로,
 * 4칸에서 죽었던 잡을 다시 돌리면 4칸부터 이어 붙는다 (앞 칸을 지우지 않는다).
 */
export async function publishThreadChain(
  token: string,
  slots: readonly ThreadsSlotInput[],
  {
    already = [],
    onSlot,
    gapMs = 1_000,
  }: {
    readonly already?: readonly ThreadsSlotResult[];
    readonly onSlot?: (result: ThreadsSlotResult) => Promise<void> | void;
    readonly gapMs?: number;
  } = {}
): Promise<ThreadsSlotResult[]> {
  const done = [...already].sort((a, b) => a.index - b.index);
  let previousId = done.length > 0 ? done[done.length - 1].postId : undefined;

  for (let index = 0; index < slots.length; index += 1) {
    if (done.some((row) => row.index === index)) continue;
    const slot = slots[index];
    const containerId = await createThreadsContainer(token, slot, previousId);
    await waitForContainer(token, containerId);
    const postId = await publishThreadsContainer(token, containerId);
    const result = { index, postId };
    done.push(result);
    previousId = postId;
    await onSlot?.(result);
    if (index < slots.length - 1) await sleep(gapMs);
  }

  return done.sort((a, b) => a.index - b.index);
}

export async function fetchThreadsPermalink(token: string, postId: string): Promise<string | null> {
  try {
    const data = await threadsGet(postId, { fields: "permalink", access_token: token });
    return typeof data.permalink === "string" ? data.permalink : null;
  } catch {
    return null;
  }
}
