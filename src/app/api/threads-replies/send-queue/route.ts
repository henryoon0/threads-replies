// 보내기 대기열 전체 (지금 계정). GET → { items } — 화면이 다른 댓글에 있어도 보낸 결과를 알리려고 읽는다. send-queue.ts
import { NextResponse } from "next/server";
import { withPersonaRequest } from "@/lib/personas/context";
import { listSendQueue } from "@/lib/threads-replies/send-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withPersonaRequest(request, async () => NextResponse.json({ items: await listSendQueue() }));
}
