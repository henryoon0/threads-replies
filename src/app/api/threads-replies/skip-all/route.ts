// 댓글 모두 건너뛰기 (로컬 원장만 바뀐다). POST { ids? } → { ids } · DELETE { ids } → 되살리기.
import { NextRequest, NextResponse } from "next/server";
import { restoreSkippedReplies, skipPendingReplies } from "@/lib/threads-replies/skip-all";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readIds(body: unknown): string[] | undefined {
  const ids = (body as { ids?: unknown })?.ids;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : undefined;
}

export async function POST(request: NextRequest) {
  const ids = readIds(await request.json().catch(() => ({})));
  return NextResponse.json({ ids: await skipPendingReplies(ids) });
}

export async function DELETE(request: NextRequest) {
  const ids = readIds(await request.json().catch(() => ({})));
  if (!ids?.length) return NextResponse.json({ error: "ids가 필요합니다" }, { status: 400 });
  return NextResponse.json({ restored: await restoreSkippedReplies(ids) });
}
