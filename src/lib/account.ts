// 계정 연결 — 받는 사람이 메타 앱 대시보드의 User Token Generator 에서 만든 토큰을 붙여넣으면,
// 스레드에 한 번 물어 진짜 토큰인지·어느 계정인지·답글 읽기 권한이 켜졌는지 확인하고 저장한다.
// 연결되면 지난 글 모으기와 말투 만들기를 바로 뒤에서 시작한다.
import { rm } from "node:fs/promises";
import { fetchMe, graphFetch, ThreadsGraphError, THREADS_GRAPH_BASE } from "@/lib/threads-archive/graph";
import { readStoredToken, tokenPath, writeStoredToken } from "@/lib/threads-archive/storage";
import { readProfile, writeProfile } from "@/lib/profile";

const TOKEN_LIFETIME_MS = 60 * 24 * 60 * 60 * 1000;

export interface AccountStatus {
  connected: boolean;
  username?: string;
  intro?: string;
  expiresAt?: string;
}

export class ConnectError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ConnectError";
  }
}

export async function accountStatus(): Promise<AccountStatus> {
  const [stored, profile] = await Promise.all([readStoredToken(), readProfile()]);
  if (!stored) return { connected: false };
  return { connected: true, username: profile.username, intro: profile.intro, expiresAt: stored.expiresAt };
}

/** 토큰 앞뒤 공백·따옴표·줄바꿈을 걷어낸다 (복사하다 흔히 딸려 온다). */
export function cleanToken(raw: string): string {
  return raw.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, "");
}

/** 메타가 주는 에러를 받는 사람이 할 일로 바꾼다. */
function explainTokenError(error: unknown): string {
  if (error instanceof ThreadsGraphError) {
    if (/"code":\s*190/.test(error.body) || error.status === 400 || error.status === 401) {
      return "토큰이 맞지 않거나 만료됐어요. 메타 앱 대시보드의 User Token Generator 에서 토큰을 다시 만들어 붙여넣어 주세요.";
    }
    return `스레드가 요청을 거절했어요 (${error.status}). 잠시 뒤 다시 시도해 주세요.`;
  }
  return "스레드에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.";
}

/** 댓글 읽기 권한(threads_read_replies)이 켜졌는지 — 없으면 앱이 할 수 있는 게 없다. */
async function checkRepliesScope(token: string): Promise<void> {
  try {
    await graphFetch(`${THREADS_GRAPH_BASE}/me/replies?fields=id&limit=1&access_token=${encodeURIComponent(token)}`);
  } catch {
    throw new ConnectError(
      "댓글을 읽는 권한이 없어요. 메타 앱의 Threads API 사용 사례에서 threads_read_replies 와 threads_manage_replies 를 추가한 뒤 토큰을 새로 만들어 주세요."
    );
  }
}

/**
 * 토큰 나이를 모르기 때문에 연결 즉시 한 번 연장을 시도한다.
 * 성공하면 진짜 만료일을 얻고, 실패하면(발급 24시간 이내라 연장 불가) 막 만든 토큰이라 60일로 본다.
 */
async function freshenToken(token: string, nowMs: number): Promise<{ accessToken: string; expiresAt: string }> {
  try {
    const data = (await graphFetch(
      `${THREADS_GRAPH_BASE.replace(/\/v[\d.]+$/, "")}/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`
    )) as { access_token?: string; expires_in?: number };
    if (data.access_token && data.expires_in) {
      return { accessToken: data.access_token, expiresAt: new Date(nowMs + data.expires_in * 1000).toISOString() };
    }
  } catch {
    // 발급 직후엔 연장이 안 된다 — 정상
  }
  return { accessToken: token, expiresAt: new Date(nowMs + TOKEN_LIFETIME_MS).toISOString() };
}

export async function connectAccount(rawToken: string, intro = "", nowMs = Date.now()) {
  const token = cleanToken(rawToken);
  if (token.length < 50) throw new ConnectError("토큰이 너무 짧아요. 끝까지 빠짐없이 복사했는지 확인해 주세요.");
  let me: { id: string; username: string };
  try {
    me = await fetchMe(token);
  } catch (error) {
    throw new ConnectError(explainTokenError(error));
  }
  await checkRepliesScope(token);
  const fresh = await freshenToken(token, nowMs);
  await writeStoredToken({
    accessToken: fresh.accessToken,
    refreshedAt: new Date(nowMs).toISOString(),
    expiresAt: fresh.expiresAt,
  });
  await writeProfile({ username: me.username, ...(intro.trim() ? { intro: intro.trim() } : {}) });
  void startFirstRun();
  return { ok: true as const, username: me.username, expiresAt: fresh.expiresAt };
}

/** 연결 직후: 지난 글 모으기 → 말투 만들기. 둘 다 뒤에서 돌고, 화면이 진행을 보여준다. */
async function startFirstRun(): Promise<void> {
  const [{ startSync }, { startVoiceBuild, packHasRulebook }] = await Promise.all([
    import("@/lib/threads-archive/sync"),
    import("@/lib/voice-build"),
  ]);
  startSync();
  if (!(await packHasRulebook())) startVoiceBuild();
}

export async function disconnectAccount(): Promise<void> {
  await rm(tokenPath(), { force: true });
}
