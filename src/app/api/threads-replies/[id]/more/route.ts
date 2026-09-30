// 다른 버전 한 벌 더: 기본 3벌과 말투가 가장 먼 남은 카테고리로 한 벌을 써서 answer.options 뒤에 붙인다.
// 이 댓글의 세션에 이어 쓰고, 근거 없는 사실 문장은 뺀다. 고르기는 기존 PATCH { chosen }.
import { NextResponse } from "next/server";
import { withPersonaRequest } from "@/lib/personas/context";
import { addMoreOption } from "@/lib/threads-replies/more-options";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

async function handlePOST(ctx: RouteCtx) {
  const { id } = await ctx.params;
  try {
    const result = await addMoreOption(id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /시간 초과|timed? ?out/i.test(message) ? 504 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request, ctx: RouteCtx) {
  return withPersonaRequest(request, () => handlePOST(ctx));
}
