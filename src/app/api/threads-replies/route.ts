// 스레드 댓글 작업대 — 원장 보기(글별 묶음 + 대화 줄기)와 로컬 편집. 발송은 여기서 하지 않는다.
import { NextRequest, NextResponse } from "next/server";
import { ensureAnswers } from "@/lib/threads-replies/answer-job";
import { ensureVariantsForPending, variantsQueueState } from "@/lib/threads-replies/compose-variants";
import { chooseOption, withOwnerDraft } from "@/lib/threads-replies/draft";
import type { ThreadsReply } from "@/lib/threads-replies/model";
import { recordMarkedAnswered } from "@/lib/threads-replies/send";
import { readAnswerJob, updateRepliesLedger } from "@/lib/threads-replies/storage";
import { groupByPost, summarize } from "@/lib/threads-replies/summary";
import { syncIfStale } from "@/lib/threads-replies/sync";
import { currentPersona, withPersonaRequest } from "@/lib/personas/context";
import { readProfile } from "@/lib/profile";
import { autoDraftPolicy } from "@/lib/threads-replies/auto-draft-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 10분 넘게 지났으면 동기화한 뒤 원장을 글별로 묶어 준다.
// 초안 없는 댓글은 백그라운드로 채운다 (?answers=0 이면 건너뜀 — 점검용).
async function handleGET(request: NextRequest) {
  const ledger = await syncIfStale();
  const persona = currentPersona();
  const policy = autoDraftPolicy(persona);
  if (request.nextUrl.searchParams.get("answers") !== "0") {
    // 첫 초안 잡은 근거 캡처를 쓰는 계정만 (10-02 비용 1) — 다른 계정은 버전 글만 화면에 나온다.
    if (policy.answerJob) void ensureAnswers("all").catch(() => {});
    // 대기 댓글 전부 미리 쓰기는 끔 (10-02 비용 2) — 화면이 지금 보는 댓글부터 10개를 POST /prefetch 로 보낸다.
    if (policy.prefetchAllOnOpen) void ensureVariantsForPending().catch(() => {});
  }
  return NextResponse.json({
    groups: groupByPost(ledger),
    summary: summarize(ledger),
    sync: ledger.sync,
    job: await readAnswerJob(),
    // 미리 쓰기 줄 (쓰는 중·차례 기다림) — 목록 표시와 빠른 새로 읽기의 기준. 예전 전체 진행률(파일 421개 읽기)은 뺐다
    variantsQueue: variantsQueueState(persona.id),
    persona: { id: persona.id, name: persona.name, handle: persona.handle, send: persona.send, gate: persona.gate },
    me: (await readProfile()).username || persona.handle,
  });
}

type PatchBody = { replyId?: string; draft?: string; skipped?: boolean; markedAnswered?: string; chosen?: number };

/** 초안 고치기({draft}: aiDraft 는 그대로) · 3벌 중 고르기({chosen}) · 건너뛰기. 실패면 이유 문자열. */
function editReply(r: ThreadsReply, body: PatchBody): ThreadsReply | string {
  const next: ThreadsReply = { ...r };
  if (typeof body.chosen === "number") {
    const picked = chooseOption(next.answer, body.chosen);
    if (typeof picked === "string") return picked;
    next.answer = picked;
  }
  if (typeof body.draft === "string") next.answer = withOwnerDraft(next.answer, body.draft);
  if (typeof body.skipped === "boolean") next.skipped = body.skipped || undefined;
  return next;
}

// PATCH: 초안 저장 / 3벌 중 고르기 / 건너뛰기 토글 / 스레드 앱에서 직접 단 답 기록 (로컬 원장만 바뀐다)
async function handlePATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const { replyId, draft, skipped, markedAnswered, chosen } = body;
  if (!replyId) return NextResponse.json({ error: "replyId가 필요합니다" }, { status: 400 });
  if (typeof markedAnswered === "string") {
    if (!markedAnswered.trim()) return NextResponse.json({ error: "단 답글이 비어 있습니다" }, { status: 400 });
    const reply = await recordMarkedAnswered(replyId, markedAnswered.trim());
    if (!reply) return NextResponse.json({ error: "해당 댓글이 원장에 없습니다" }, { status: 404 });
    return NextResponse.json({ reply });
  }
  if (typeof draft !== "string" && typeof skipped !== "boolean" && typeof chosen !== "number") {
    return NextResponse.json({ error: "draft · chosen · skipped · markedAnswered 중 하나가 필요합니다" }, { status: 400 });
  }
  let found: ThreadsReply | undefined;
  let failed: string | undefined;
  await updateRepliesLedger((ledger) => ({
    ...ledger,
    replies: ledger.replies.map((r) => {
      if (r.id !== replyId) return r;
      const next = editReply(r, body);
      if (typeof next === "string") {
        failed = next;
        return r;
      }
      found = next;
      return next;
    }),
  }));
  if (failed) return NextResponse.json({ error: failed }, { status: 400 });
  if (!found) return NextResponse.json({ error: "해당 댓글이 원장에 없습니다" }, { status: 404 });
  return NextResponse.json({ reply: found });
}

// 요청마다 지금 페르소나(?persona= 또는 쿠키)로 감싼다 — 원장·토큰·규칙책이 그 계정 것으로 갈린다.
export async function GET(request: NextRequest) {
  return withPersonaRequest(request, () => handleGET(request));
}

export async function PATCH(request: NextRequest) {
  return withPersonaRequest(request, () => handlePATCH(request));
}
