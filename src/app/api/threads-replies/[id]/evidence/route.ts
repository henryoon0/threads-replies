import { NextRequest, NextResponse } from "next/server";
import { readRepliesLedger } from "@/lib/threads-replies/storage";
import { captureEvidence, isShootable } from "@/lib/threads-replies/evidence-shot";

// 근거 한 건의 원문 형광 캡처 (픽 6). POST { sourceId } → { shot }.
// 원장에는 쓰지 않는다 — 캡처를 답글에 붙일지는 호출하는 쪽이 정한다.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { sourceId?: unknown };
  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
  if (!sourceId) return NextResponse.json({ error: "sourceId가 필요합니다" }, { status: 400 });

  const ledger = await readRepliesLedger();
  const reply = ledger.replies.find((r) => r.id === id);
  if (!reply) return NextResponse.json({ error: "댓글을 찾을 수 없어요" }, { status: 404 });
  const source = reply.answer?.sources.find((s) => s.id === sourceId);
  if (!source) return NextResponse.json({ error: "근거를 찾을 수 없어요" }, { status: 404 });
  if (!isShootable(source)) {
    return NextResponse.json(
      { error: "원본 주소가 있는 근거(원글 원본·웹·붙인 링크)만 캡처할 수 있어요" },
      { status: 422 }
    );
  }

  const shot = await captureEvidence(id, source);
  if (!shot) {
    return NextResponse.json({ error: "원문에서 인용을 찾아 찍지 못했어요" }, { status: 502 });
  }
  return NextResponse.json({ shot });
}
