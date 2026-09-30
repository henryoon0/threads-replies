// 제안 한 장 판결: POST { action: "apply" | "reject" }.
// apply = 찾기/바꾸기가 규칙책에 정확히 한 번 있을 때만 바꾸고 팩에 커밋 → { status: "applied", commit }.
// 안전 잠금(처방약·제품 표현, 잠긴 규칙 약화, SAFETY.md)은 자동 거절 → 409 { status: "locked", reason }.
// reject = backpass 거절 저장소에 적어 새 증거 없이는 다시 안 오게 한다.
import { NextResponse } from "next/server";
import { currentPersona, withPersonaRequest } from "@/lib/personas/context";
import { applyProposal, decisionHttpStatus, rejectProposal } from "@/lib/personas/learning/apply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ pid: string }> };

async function handlePOST(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const action = body?.action;
  if (action !== "apply" && action !== "reject") {
    return NextResponse.json({ error: 'action 은 "apply" 또는 "reject" 여야 해요' }, { status: 400 });
  }
  try {
    const persona = currentPersona();
    const result = action === "apply" ? await applyProposal(persona, pid) : await rejectProposal(persona, pid);
    return NextResponse.json(result, { status: decisionHttpStatus(result) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `제안을 처리하지 못했어요: ${message}` }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: Ctx) {
  return withPersonaRequest(request, () => handlePOST(request, ctx));
}
