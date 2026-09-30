// 스레드 댓글 지금 동기화 (읽기 전용 API). body.posts 로 훑을 글 수를 정한다 (기본 20, 최대 100).
import { NextRequest, NextResponse } from "next/server";
import { summarize } from "@/lib/threads-replies/summary";
import { syncReplies } from "@/lib/threads-replies/sync";
import { withPersonaRequest } from "@/lib/personas/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { posts?: unknown };
  const posts =
    typeof body.posts === "number" && Number.isInteger(body.posts) && body.posts > 0 ? Math.min(body.posts, 100) : undefined;
  const ledger = await syncReplies({ posts });
  const status = ledger.sync.lastError && !ledger.sync.postsScanned ? 502 : 200;
  return NextResponse.json({ sync: ledger.sync, summary: summarize(ledger) }, { status });
}

// 요청마다 지금 페르소나(?persona= 또는 쿠키)로 감싼다 — 원장·토큰·규칙책이 그 계정 것으로 갈린다.
export async function POST(request: NextRequest) {
  return withPersonaRequest(request, () => handlePOST(request));
}
