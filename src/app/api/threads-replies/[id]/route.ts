// 답 패널 한 건: { reply, post, conversation, drafting }. 읽기만 한다.
import { NextResponse } from "next/server";
import { readReplyView } from "@/lib/threads-replies/reply-view";
import { withPersonaRequest } from "@/lib/personas/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await readReplyView(id);
  if (!view) return NextResponse.json({ error: "해당 댓글이 원장에 없습니다" }, { status: 404 });
  return NextResponse.json(view);
}

// 요청마다 지금 페르소나(?persona= 또는 쿠키)로 감싼다 — 원장·토큰·규칙책이 그 계정 것으로 갈린다.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withPersonaRequest(request, () => handleGET(request, ctx));
}
