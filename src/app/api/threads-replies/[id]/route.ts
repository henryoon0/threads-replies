// 답 패널 한 건: { reply, post, conversation, drafting }. 읽기만 한다.
import { NextResponse } from "next/server";
import { readReplyView } from "@/lib/threads-replies/reply-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await readReplyView(id);
  if (!view) return NextResponse.json({ error: "해당 댓글이 원장에 없습니다" }, { status: 404 });
  return NextResponse.json(view);
}
