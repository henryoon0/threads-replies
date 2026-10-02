// 스레드 댓글에 답글 달기 (픽 6: 하나씩 + 되돌리기). 5초 되돌리기는 화면이 세고, 여기는 실제로 보낸다.
// 게시는 자동 발행과 같은 컨테이너 → 준비 대기 → 발행 3단계를 쓴다 (publish/threads.ts). reply_to_id = 댓글 id.
// 남의 댓글에 답하려면 threads_manage_replies 스코프가 필요하다. 없으면 권한 오류로 분류해
// 화면이 [복사하고 스레드에서 열기] 폴백을 띄운다.
//
// 페르소나별 보내기 (docs/reply-persona-design.md 4-6, 시안 픽 14):
//   - 서버가 보낼 글로 안전 관문을 다시 돈다. strict 팩(박약사)에 block 표현이 있으면 절대 안 보낸다(kind "gate").
//   - send: "copy" 팩은 Threads API 를 부르지 않고 { mode: "copy", text, permalink } 를 돌려준다.
//     주인이 스레드에서 직접 단 뒤 [달았어요] → recordMarkedAnswered 가 원장과 학습 기록을 남긴다.
//   - 보낸 답은 팩 private/reply-log.jsonl 에 한 줄 (학습 기록, 시안 픽 15). 기록 실패가 보내기를 실패시키지 않는다.
import { buildAuthUrl } from "@/lib/threads-archive/graph";
import {
  ThreadsPublishError,
  createThreadsContainer,
  publishThreadsContainer,
  waitForContainer,
} from "@/lib/publish/threads";
import { removeEphemeralMedia, uploadEphemeralMedia } from "@/lib/share/ephemeral-media";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { currentPersona } from "@/lib/personas/context";
import { resolveSendMode } from "@/lib/personas/registry";
import { postedText } from "./posted-text";
import { gateForPersona } from "@/lib/personas/gate-rules";
import { startReplyOutcomeTimer } from "@/lib/personas/learning/outcome";
import { aiDraftOf, logReply, sentAction, type ReplyLogAction, type ReplyLogEntry } from "@/lib/personas/learning/reply-log";
import { readyToken } from "./graph";
import { evidenceReplyDir } from "./storage";
import type { GateResult, ThreadsRepliesLedger, ThreadsReply } from "./model";
import { readRepliesLedger, updateRepliesLedger } from "./storage";

export type SendErrorKind = "permission" | "token" | "rate" | "other";

export type SendResult =
  | { ok: true; mode: "api"; reply: ThreadsReply; log?: ReplyLogEntry }
  | { ok: true; mode: "copy"; text: string; permalink?: string }
  | {
      ok: false;
      kind: SendErrorKind | "not-found" | "already" | "empty" | "busy" | "gate";
      message: string;
      reauthUrl?: string;
      gate?: GateResult;
    };

const MAX_LEN = 500;

/** 답글에 붙일 이미지. 스레드는 JPEG·PNG 만, 8MB 까지 받는다. */
export interface ReplyImage {
  readonly buffer: Buffer;
  readonly ext: "jpg" | "png";
}

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * 근거 캡처 경로(/threads-evidence/<댓글>/<파일>.png)를 읽는다. 그 댓글의 캡처 폴더 밖이면 거절한다
 * (화면이 보낸 경로를 그대로 믿으면 서버의 아무 파일이나 공개로 올릴 수 있다).
 */
export async function readEvidenceImage(replyId: string, publicPath: string): Promise<ReplyImage | string> {
  const dir = evidenceReplyDir(replyId);
  const file = path.resolve(dir, path.basename(publicPath));
  if (!publicPath.startsWith(`/threads-evidence/${path.basename(dir)}/`) || path.dirname(file) !== dir) {
    return "근거 캡처 경로가 이 댓글 것이 아니에요.";
  }
  if (!/\.(png|jpe?g)$/i.test(file)) return "근거 캡처는 PNG·JPG 만 붙일 수 있어요.";
  try {
    const buffer = await readFile(file);
    if (buffer.length > MAX_IMAGE_BYTES) return "근거 캡처가 8MB 를 넘어요.";
    return { buffer, ext: /\.png$/i.test(file) ? "png" : "jpg" };
  } catch {
    return "근거 캡처 파일을 찾지 못했어요. 다시 찍어 주세요.";
  }
}

/** data:image/...;base64,... 를 ReplyImage 로. 형식·크기가 안 맞으면 오류 문구. */
export function parseReplyImage(dataUrl: string): ReplyImage | string {
  const m = /^data:image\/(jpeg|jpg|png);base64,(.+)$/i.exec(dataUrl);
  if (!m) return "이미지는 JPG·PNG 만 붙일 수 있어요.";
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > MAX_IMAGE_BYTES) return "이미지는 8MB 까지 붙일 수 있어요.";
  return { buffer, ext: m[1].toLowerCase() === "png" ? "png" : "jpg" };
}

interface ErrorShape {
  status?: number;
  body: string;
  message: string;
}

function shapeOf(error: unknown): ErrorShape {
  if (error instanceof ThreadsPublishError) return { status: error.status, body: error.body, message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  return { body: "", message };
}

function codeOf(body: string): number | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: number } };
    return parsed.error?.code;
  } catch {
    return undefined;
  }
}

const RATE_CODES = new Set([4, 17, 32, 613]);
const PERMISSION_CODES = new Set([10, 200]);

type Probe = { status?: number; code?: number; text: string };

const isRate = ({ status, code, text }: Probe) =>
  status === 429 || (code !== undefined && RATE_CODES.has(code)) || /rate limit|too many/i.test(text);
const isToken = ({ status, code, text }: Probe) =>
  code === 190 || status === 401 || /session has expired|access token|THREADS_ACCESS_TOKEN|재인증/i.test(text);
const isPermission = ({ status, code, text }: Probe) =>
  (code !== undefined && PERMISSION_CODES.has(code)) || status === 403 || /permission|threads_manage_replies/i.test(text);

/** 실패를 사람이 할 일 기준으로 나눈다: 권한 추가(재인증) · 토큰 재발급 · 잠시 뒤 · 그 밖. */
export function classifySendError(error: unknown): SendErrorKind {
  const { status, body, message } = shapeOf(error);
  const probe: Probe = { status, code: codeOf(body), text: `${message} ${body}` };
  if (isRate(probe)) return "rate";
  if (isToken(probe)) return "token";
  if (isPermission(probe)) return "permission";
  return "other";
}

const KIND_MESSAGE: Record<SendErrorKind, string> = {
  permission: "남의 댓글에 답하는 권한(threads_manage_replies)이 토큰에 없어요. 다시 인증하거나 스레드 앱에서 직접 달아 주세요.",
  token: "스레드 토큰이 만료됐어요. 다시 인증해야 보낼 수 있어요.",
  rate: "스레드가 잠시 요청을 막았어요. 몇 분 뒤 다시 보내 주세요.",
  other: "스레드에 답글을 올리지 못했어요.",
};

// 같은 댓글에 두 번 보내지 않게 (hot reload 재평가에도 하나) — AGENTS.md 잡 가드 규칙.
function inFlight(): Set<string> {
  const g = globalThis as typeof globalThis & { __threadsReplySending?: Set<string> };
  g.__threadsReplySending ??= new Set();
  return g.__threadsReplySending;
}

async function postReply(commentId: string, message: string, image?: ReplyImage): Promise<string> {
  const token = await readyToken();
  if (!image) {
    const containerId = await createThreadsContainer(token, { text: message }, commentId);
    await waitForContainer(token, containerId);
    return publishThreadsContainer(token, containerId);
  }
  // 이미지는 공개 주소가 있어야 스레드가 가져간다. 발행이 끝나면(성공·실패 모두)
  // Cloudflare 에서 파일과 그 배포까지 지운다 — 남겨 두지 않는다 (2026-09-27 henry 요청).
  const media = await uploadEphemeralMedia(image.buffer, image.ext);
  try {
    const containerId = await createThreadsContainer(token, { text: message, imageUrl: media.url }, commentId);
    await waitForContainer(token, containerId); // FINISHED = 스레드가 이미지를 자기 쪽에 복사했다
    return await publishThreadsContainer(token, containerId);
  } finally {
    await removeEphemeralMedia(media);
  }
}

/** 원장에 내 답을 기록한다. id 가 "manual" 이면 스레드 앱에서 직접 단 답. */
export async function recordMyReply(replyId: string, myReply: NonNullable<ThreadsReply["myReply"]>): Promise<ThreadsReply | undefined> {
  let found: ThreadsReply | undefined;
  await updateRepliesLedger((ledger) => ({
    ...ledger,
    replies: ledger.replies.map((r) => {
      if (r.id !== replyId) return r;
      found = { ...r, myReply, skipped: undefined };
      return found;
    }),
  }));
  return found;
}

type Failure = Extract<SendResult, { ok: false }>;

/** 보내기 전 확인: 빈 답 · 너무 긴 답 · 없는 댓글 · 이미 답한 댓글. 통과하면 그 댓글과 원장. */
async function precheck(replyId: string, text: string, hasImage = false): Promise<{ reply: ThreadsReply; ledger: ThreadsRepliesLedger } | Failure> {
  if (!text && !hasImage) return { ok: false, kind: "empty", message: "보낼 답글이 비어 있어요." };
  if (text.length > MAX_LEN) return { ok: false, kind: "empty", message: `답글은 ${MAX_LEN}자까지 보낼 수 있어요.` };
  const ledger = await readRepliesLedger();
  const reply = ledger.replies.find((r) => r.id === replyId);
  if (!reply) return { ok: false, kind: "not-found", message: "해당 댓글이 원장에 없어요." };
  if (reply.myReply) return { ok: false, kind: "already", message: "이미 답한 댓글이에요." };
  return { reply, ledger };
}

/** 학습 기록 한 줄. 실패해도 보내기 결과는 그대로다(기록은 부가). */
async function logSafely(reply: ThreadsReply, final: string, action: ReplyLogAction, gate: GateResult): Promise<ReplyLogEntry | undefined> {
  try {
    const entry = await logReply({ reply, persona: currentPersona().id, action, final, gate: gate.status });
    if (entry.outcome === "pending") startReplyOutcomeTimer(); // 유예가 지나면 결과 기록 턴을 쓸 스윕이 돌고 있게
    return entry;
  } catch (error) {
    console.warn("[threads-replies] 학습 기록 실패:", error instanceof Error ? error.message : error);
    return undefined;
  }
}

const GATE_MESSAGE = "안전 관문에 걸린 표현이 있어 보내지 않았어요. 칠해진 부분을 고친 뒤 다시 보내 주세요.";

function failureOf(error: unknown): Failure {
  const kind = classifySendError(error);
  const detail = shapeOf(error).message;
  const needsAuth = kind === "permission" || kind === "token";
  return {
    ok: false,
    kind,
    message: kind === "other" && detail ? `${KIND_MESSAGE.other} (${detail})` : KIND_MESSAGE[kind],
    reauthUrl: needsAuth ? buildAuthUrl() : undefined,
  };
}

async function postAndRecord(reply: ThreadsReply, text: string, gate: GateResult, image?: ReplyImage): Promise<SendResult> {
  const sending = inFlight();
  if (sending.has(reply.id)) return { ok: false, kind: "busy", message: "이 댓글에 보내는 중이에요." };
  sending.add(reply.id);
  try {
    const postedId = await postReply(reply.id, text, image);
    const myReply = { id: postedId, text, timestamp: new Date().toISOString(), ...(image ? { withImage: true } : {}) };
    const saved = await recordMyReply(reply.id, myReply);
    const log = await logSafely(reply, text, sentAction(aiDraftOf(reply.answer), text), gate);
    return { ok: true, mode: "api", reply: saved ?? { ...reply, myReply }, log };
  } catch (error) {
    return failureOf(error);
  } finally {
    sending.delete(reply.id);
  }
}

export async function sendThreadsReply(replyId: string, message: string, image?: ReplyImage): Promise<SendResult> {
  const text = postedText(message);
  const checked = await precheck(replyId, text, Boolean(image));
  if ("ok" in checked) return checked;
  const { reply, ledger } = checked;
  const persona = currentPersona();
  // 화면이 무엇을 보여줬든 서버가 보낼 글로 다시 검사한다. light 팩은 block 이 check 로 낮춰져 막히지 않는다.
  const gate = await gateForPersona(text, persona);
  if (gate.status === "block") {
    await logSafely(reply, text, "gate_blocked", gate);
    return { ok: false, kind: "gate", message: GATE_MESSAGE, gate };
  }
  if ((await resolveSendMode(persona)) === "copy") {
    return { ok: true, mode: "copy", text, permalink: ledger.posts.find((p) => p.id === reply.postId)?.permalink };
  }
  return postAndRecord(reply, text, gate, image);
}

/**
 * 스레드 앱에서 직접 단 답을 기록한다 — 복사 모드 팩의 [달았어요]와 권한 폴백의 [달았어요].
 * PATCH /api/threads-replies { markedAnswered } 가 recordMyReply 대신 이걸 부른다: 원장 myReply + 학습 기록(action "copied").
 * 관문에 걸린 글이면 기록은 남기되 학습에서 뺀다(learn: false).
 */
export async function recordMarkedAnswered(replyId: string, text: string): Promise<ThreadsReply | undefined> {
  const final = text.trim();
  const reply = await recordMyReply(replyId, { id: "manual", text: final, timestamp: new Date().toISOString() });
  if (reply) await logSafely(reply, final, "copied", await gateForPersona(final));
  return reply;
}
