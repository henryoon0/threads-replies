// "다른 버전" 한 벌 더 (09-29 henry: "초안 3벌은 기본, 나머지 다양한 버전은 한 칸 안에서 버튼으로 바뀌게").
// 기본 3벌 뒤에 남은 카테고리로 한 벌씩 붙여 answer.options 에 쌓는다 (4번째부터가 다른 버전).
// 같은 댓글 요청은 한 줄로 세운다: 미리 받기와 버튼 누르기가 겹쳐도 같은 세션에 동시에 이어 쓰지 않는다.
import { currentPersona } from "@/lib/personas/context";
import { checkFinal } from "./consistency";
import { NOTE_SOURCE_ID, POST_SOURCE_ID, generateMoreOption, type MoreInput } from "./draft";
import type { DraftOption, ReplyAnswer, ThreadsPostRef, ThreadsRepliesLedger, ThreadsReply } from "./model";
import { envMs, keyedLock, ledgerPath, readRepliesLedger, updateRepliesLedger } from "./storage";
import { conversationFor } from "./summary";

const DEFAULT_MORE_TIMEOUT_MS = 4 * 60 * 1000;

export type MoreResult = { answer: ReplyAnswer; added: boolean } | { error: string; status: number };

export async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, label = "다른 버전"): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} 시간 초과 (${Math.round(ms / 1000)}초)`));
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** 같은 초안 묶음(세션·생성 시각)일 때만 새 벌을 붙인다. 그 사이 다시 쓰기로 바뀌었으면 버린다. */
function appendOption(r: ThreadsReply, base: ReplyAnswer, opt: DraftOption): ThreadsReply {
  const a = r.answer;
  if (!a?.options || a.generatedAt !== base.generatedAt || a.options.some((o) => o.categoryId === opt.categoryId)) return r;
  return { ...r, answer: { ...a, options: [...a.options, opt] } };
}

function postOf(ledger: ThreadsRepliesLedger, reply: ThreadsReply): ThreadsPostRef {
  return ledger.posts.find((p) => p.id === reply.postId) ?? { id: reply.postId, text: "", timestamp: "" };
}

/** 초안 때 쓴 근거·주인 메모를 그대로 싣는다 (내 글 본문 "p"는 초안기가 따로 붙인다). */
function moreInput(ledger: ThreadsRepliesLedger, reply: ThreadsReply, answer: ReplyAnswer): MoreInput {
  const note = answer.sources.find((s) => s.id === NOTE_SOURCE_ID)?.quote;
  return {
    reply,
    post: postOf(ledger, reply),
    sources: answer.sources.filter((s) => s.id !== POST_SOURCE_ID && s.id !== NOTE_SOURCE_ID),
    conversation: conversationFor(ledger, reply),
    ...(note ? { henryNote: note } : {}),
    answer,
  };
}

async function saveOption(replyId: string, answer: ReplyAnswer, opt: DraftOption): Promise<MoreResult> {
  const next = await updateRepliesLedger((l) => ({ ...l, replies: l.replies.map((r) => (r.id === replyId ? appendOption(r, answer, opt) : r)) }));
  const saved = next.replies.find((r) => r.id === replyId)?.answer ?? answer;
  return { answer: saved, added: (saved.options?.length ?? 0) > (answer.options?.length ?? 0) };
}

async function addOnce(replyId: string): Promise<MoreResult> {
  const ledger = await readRepliesLedger();
  const reply = ledger.replies.find((r) => r.id === replyId);
  if (!reply) return { error: "해당 댓글이 원장에 없습니다", status: 404 };
  const answer = reply.answer;
  if (!answer?.options?.length) return { error: "먼저 초안 3벌이 있어야 해요", status: 409 };
  const input = moreInput(ledger, reply, answer);
  const opt = await withTimeout((signal) => generateMoreOption(input, { signal }), envMs("THREADS_ANSWER_TIMEOUT_MS", DEFAULT_MORE_TIMEOUT_MS));
  return opt ? saveOption(replyId, answer, await withPastCheck(opt, answer)) : { answer, added: false };
}

/** 새 벌도 예전 답과 대조한다. 실패하면 칠하기 없이 붙인다. */
async function withPastCheck(opt: DraftOption, answer: ReplyAnswer): Promise<DraftOption> {
  if (!answer.pastSaid?.length) return opt;
  try {
    return { ...opt, consistency: await checkFinal(opt.draft, answer.pastSaid, currentPersona().ownerName) };
  } catch {
    return opt;
  }
}

/** 댓글 하나에 다른 버전 한 벌을 더한다. 남은 카테고리가 없으면 added=false. */
export function addMoreOption(replyId: string): Promise<MoreResult> {
  const lock = keyedLock("more", `${ledgerPath()}#${replyId}`);
  const run = lock.tail.then(() => addOnce(replyId));
  lock.tail = run.catch(() => undefined);
  return run;
}
