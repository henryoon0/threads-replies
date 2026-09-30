// 댓글 모두 건너뛰기 (로컬 원장만 바뀐다). POST { ids? } → { ids } · DELETE { ids } → 되살리기.
import { NextRequest, NextResponse } from "next/server";
import { restoreSkippedReplies, skipPendingReplies } from "@/lib/threads-replies/skip-all";
import { withPersonaRequest } from "@/lib/personas/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readIds(body: unknown): string[] | undefined {
  const ids = (body as { ids?: unknown })?.ids;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : undefined;
}

async function handlePOST(request: NextRequest) {
  const ids = readIds(await request.json().catch(() => ({})));
  return NextResponse.json({ ids: await skipPendingReplies(ids) });
}

async function handleDELETE(request: NextRequest) {
  const ids = readIds(await request.json().catch(() => ({})));
  if (!ids?.length) return NextResponse.json({ error: "ids가 필요합니다" }, { status: 400 });
  return NextResponse.json({ restored: await restoreSkippedReplies(ids) });
}

// 요청마다 지금 페르소나(?persona= 또는 쿠키)로 감싼다 — 원장·토큰·규칙책이 그 계정 것으로 갈린다.
export async function POST(request: NextRequest) {
  return withPersonaRequest(request, () => handlePOST(request));
}

export async function DELETE(request: NextRequest) {
  return withPersonaRequest(request, () => handleDELETE(request));
}
