// 답 패널 한 건 보기: 댓글 · 그 글 · 거기까지의 대화 · 초안 잡이 지금 이 댓글을 쓰는 중인지.
// 원장·잡 파일만 읽는다 (동기화·AI·외부 호출 없음).
import type { ThreadsPostRef, ThreadsReply } from "./model";
import { readAnswerJob, readRepliesLedger } from "./storage";
import { readProfile } from "@/lib/profile";
import { conversationFor } from "./summary";

export interface ReplyView {
  reply: ThreadsReply;
  post: ThreadsPostRef | null;
  conversation: { username: string; text: string }[];
  /** 백그라운드 초안 잡이 이 댓글을 아직 처리할 차례로 들고 있다 */
  drafting: boolean;
}

export async function readReplyView(replyId: string): Promise<ReplyView | null> {
  const [ledger, job] = await Promise.all([readRepliesLedger(), readAnswerJob()]);
  const reply = ledger.replies.find((r) => r.id === replyId);
  if (!reply) return null;
  const waiting =
    job?.status === "running" &&
    job.replyIds.includes(replyId) &&
    !job.done.includes(replyId) &&
    !job.failed.some((f) => f.replyId === replyId);
  return {
    reply,
    post: ledger.posts.find((p) => p.id === reply.postId) ?? null,
    conversation: conversationFor(ledger, reply, (await readProfile()).username) ?? [],
    drafting: !reply.answer && Boolean(waiting),
  };
}
