// 규칙책 손보기:
//   POST { id: "AG-012", action: "delete", hash? } → 그 규칙(과 딸린 예시 줄)을 지우고 팩에 커밋. 잠긴 규칙은 409.
//     hash 를 주면 화면을 연 뒤 번호가 밀렸는지 확인한다(밀렸으면 409).
//   POST { id: "pt-…", action: "add" } → 패턴 카드의 규칙 문장을 "학습으로 더한 규칙" 절에 더하고 커밋.
//     근거가 3건보다 적거나 안전 잠금이면 409.
import { NextResponse } from "next/server";
import { currentPersona, withPersonaRequest } from "@/lib/personas/context";
import { addPatternRule, decisionHttpStatus, deleteRule } from "@/lib/personas/learning/apply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RuleAction = { id: string; action: "delete" | "add"; hash?: string };

function parseBody(body: { id?: unknown; action?: unknown; hash?: unknown } | null): RuleAction | null {
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const action = body?.action;
  if (!id || (action !== "delete" && action !== "add")) return null;
  return { id, action, hash: typeof body?.hash === "string" ? body.hash : undefined };
}

async function handlePOST(request: Request) {
  const input = parseBody(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: 'id 와 action("delete" | "add")이 필요해요' }, { status: 400 });
  try {
    const persona = currentPersona();
    const result = input.action === "delete" ? await deleteRule(persona, input.id, input.hash) : await addPatternRule(persona, input.id);
    return NextResponse.json(result, { status: decisionHttpStatus(result) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `규칙책을 바꾸지 못했어요: ${message}` }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return withPersonaRequest(request, () => handlePOST(request));
}
