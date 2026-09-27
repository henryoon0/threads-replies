// 스레드 댓글 작업대 — 원장 보기(글별 묶음 + 대화 줄기)와 로컬 편집. 발송은 여기서 하지 않는다.
import { NextRequest, NextResponse } from "next/server";
import { ensureAnswers } from "@/lib/threads-replies/answer-job";
import type { ReplyAnswer, ThreadsReply } from "@/lib/threads-replies/model";
import { recordMyReply } from "@/lib/threads-replies/send";
import { readAnswerJob, updateRepliesLedger } from "@/lib/threads-replies/storage";
import { readProfile } from "@/lib/profile";
import { groupByPost, summarize } from "@/lib/threads-replies/summary";
import { syncIfStale } from "@/lib/threads-replies/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 10분 넘게 지났으면 동기화한 뒤 원장을 글별로 묶어 준다.
// 초안 없는 댓글은 백그라운드로 채운다 (?answers=0 이면 건너뜀 — 점검용).
export async function GET(request: NextRequest) {
  const ledger = await syncIfStale();
  if (request.nextUrl.searchParams.get("answers") !== "0") {
    void ensureAnswers("all").catch(() => {});
  }
  return NextResponse.json({
    groups: groupByPost(ledger),
    me: (await readProfile()).username,
    summary: summarize(ledger),
    sync: ledger.sync,
    job: await readAnswerJob(),
  });
}

/** henry 가 손으로 쓴 초안. 아직 AI 초안이 없던 댓글이면 근거 없는 답으로 만든다. */
function withDraft(reply: ThreadsReply, draft: string): ReplyAnswer {
  if (reply.answer) return { ...reply.answer, draft };
  return {
    verdict: "unknown",
    verdictReason: "henry 가 직접 쓴 답",
    sources: [],
    sentences: [{ text: draft, sourceIds: [] }],
    draft,
    model: "henry",
    generatedAt: new Date().toISOString(),
    styleExamples: 0,
  };
}

// PATCH: 초안 저장 / 건너뛰기 토글 / 스레드 앱에서 직접 단 답 기록 (로컬 원장만 바뀐다)
export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    replyId?: string;
    draft?: string;
    skipped?: boolean;
    markedAnswered?: string;
  };
  const { replyId, draft, skipped, markedAnswered } = body;
  if (!replyId) return NextResponse.json({ error: "replyId가 필요합니다" }, { status: 400 });
  if (typeof markedAnswered === "string") {
    if (!markedAnswered.trim()) return NextResponse.json({ error: "단 답글이 비어 있습니다" }, { status: 400 });
    const reply = await recordMyReply(replyId, { id: "manual", text: markedAnswered.trim(), timestamp: new Date().toISOString() });
    if (!reply) return NextResponse.json({ error: "해당 댓글이 원장에 없습니다" }, { status: 404 });
    return NextResponse.json({ reply });
  }
  if (typeof draft !== "string" && typeof skipped !== "boolean") {
    return NextResponse.json({ error: "draft · skipped · markedAnswered 중 하나가 필요합니다" }, { status: 400 });
  }
  let found: ThreadsReply | undefined;
  await updateRepliesLedger((ledger) => ({
    ...ledger,
    replies: ledger.replies.map((r) => {
      if (r.id !== replyId) return r;
      const next: ThreadsReply = { ...r };
      if (typeof draft === "string") next.answer = withDraft(r, draft);
      if (typeof skipped === "boolean") next.skipped = skipped || undefined;
      found = next;
      return next;
    }),
  }));
  if (!found) return NextResponse.json({ error: "해당 댓글이 원장에 없습니다" }, { status: 404 });
  return NextResponse.json({ reply: found });
}
