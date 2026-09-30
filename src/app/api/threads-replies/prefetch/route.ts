// 지금 답할 댓글의 버전 미리 쓰기를 줄 맨 앞으로 (2026-09-30 henry: "지금 답할 5개는 매번 초안이 완성돼 있어야").
//   POST { ids: string[] }              → { queued }        화면의 "지금 답할" 순서 그대로 앞에 세운다 (멱등, 다 쓴 댓글은 건너뜀).
//   POST { ids: string[], fresh: true } → { queued, busy }  미리 쓴 벌을 버리고 처음부터 다시 쓴다 ([5개 새로 돌리기]·[버전 전부 새로]).
// 목록 GET 의 미리 쓰기는 최신순 60개라, 오래 기다린 질문이 먼저인 "지금 답할 5개"와 순서가 어긋난다.
import { NextResponse } from "next/server";
import { withPersonaRequest } from "@/lib/personas/context";
import { ensureVariants, restartVariants } from "@/lib/threads-replies/compose-variants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IDS = 20;

async function handlePOST(request: Request) {
  const body = (await request.json().catch(() => null)) as { ids?: unknown; fresh?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, MAX_IDS) : [];
  if (!ids.length) return NextResponse.json({ error: "ids 가 필요해요" }, { status: 400 });
  if (body?.fresh === true) return NextResponse.json(await restartVariants(ids));
  return NextResponse.json({ queued: await ensureVariants(ids, { front: true }) });
}

export async function POST(request: Request) {
  return withPersonaRequest(request, () => handlePOST(request));
}
