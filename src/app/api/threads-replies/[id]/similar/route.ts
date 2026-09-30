// 비슷한 맥락에서 남긴 글: GET → { items: SimilarItem[] }. 관련성 게이트를 통과한 답만, 제품 권유 답(learn=false)도 포함.
import { NextResponse } from "next/server";
import { currentPersona, withPersonaRequest } from "@/lib/personas/context";
import { similarFor } from "@/lib/threads-replies/similar";
import { readRepliesLedger } from "@/lib/threads-replies/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

async function handleGET(ctx: RouteCtx) {
  const { id } = await ctx.params;
  const ledger = await readRepliesLedger();
  const reply = ledger.replies.find((r) => r.id === id);
  if (!reply) return NextResponse.json({ error: "해당 댓글이 원장에 없습니다" }, { status: 404 });
  return NextResponse.json({ items: await similarFor(currentPersona().id, ledger, reply) });
}

export async function GET(request: Request, ctx: RouteCtx) {
  return withPersonaRequest(request, () => handleGET(ctx));
}
