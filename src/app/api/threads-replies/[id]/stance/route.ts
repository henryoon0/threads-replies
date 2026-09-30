// 주제 입장 카드 한 장: GET → { topic, summary, items[], source }. 읽기만 한다.
// "이 주제에 내가 해 온 말" — 지난 답글·글을 찾아 번호를 붙이고 1~2문장으로 요약 (lib/threads-replies/stance.ts).
import { NextResponse } from "next/server";
import { currentPersona, withPersonaRequest } from "@/lib/personas/context";
import { readRepliesLedger } from "@/lib/threads-replies/storage";
import { stanceFor } from "@/lib/threads-replies/stance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ledger = await readRepliesLedger();
  const reply = ledger.replies.find((r) => r.id === id);
  if (!reply) return NextResponse.json({ error: "해당 댓글이 원장에 없습니다" }, { status: 404 });
  const post = ledger.posts.find((p) => p.id === reply.postId);
  try {
    const stance = await stanceFor({
      personaId: currentPersona().id,
      commentText: reply.text,
      postText: post?.text ?? "",
      replyId: reply.id,
      excludeIds: reply.myReply ? [reply.myReply.id] : [],
    });
    return NextResponse.json(stance);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `입장 카드를 만들지 못했어요: ${message}` }, { status: 502 });
  }
}

// 요청마다 지금 페르소나(?persona= 또는 쿠키)로 감싼다 — 원장·지식이 그 계정 것으로 갈린다.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withPersonaRequest(request, () => handleGET(request, ctx));
}
