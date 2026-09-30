// 적용 되돌리기: POST { commit } → 팩에서 그 커밋을 git revert → { status: "reverted", commit: 새 커밋 }.
// 학습이 만든 커밋(규칙책·기술 파일만 바꾼 것)만 되돌린다. 뒤 변경과 겹치면 멈추고 409.
import { NextResponse } from "next/server";
import { currentPersona, withPersonaRequest } from "@/lib/personas/context";
import { decisionHttpStatus, revertCommit } from "@/lib/personas/learning/apply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(request: Request) {
  const body = (await request.json().catch(() => null)) as { commit?: unknown } | null;
  const commit = typeof body?.commit === "string" ? body.commit.trim() : "";
  if (!commit) return NextResponse.json({ error: "commit 이 필요해요" }, { status: 400 });
  try {
    const result = await revertCommit(currentPersona(), commit);
    return NextResponse.json(result, { status: decisionHttpStatus(result) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `되돌리지 못했어요: ${message}` }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return withPersonaRequest(request, () => handlePOST(request));
}
