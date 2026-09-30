// 토글 초안 미리 쓴 벌 (토글을 누르면 바로 보이게).
//   GET  → { variants: [{ key, toggles, draft, sections, products, ms }], pending: string[], failed: [{ key, error }], status }
//          status: "running"|"done"|"queued"|"none". 없거나 규칙책이 바뀌었으면 미리 쓰기를 줄 세운다.
//          key 는 toggles 의 열쇠 (예 "principle+product:pharmacy"). ?key=… 대신 화면은 toggles 로 열쇠를 만들 수 있다.
//   POST { key } → { variant, answer }  그 벌을 고른 초안으로 저장 (draft = aiDraft = 그 글)
import { NextResponse } from "next/server";
import { withPersonaRequest } from "@/lib/personas/context";
import { chooseVariant, variantsFor } from "@/lib/threads-replies/compose-variants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
}

async function handleGET(ctx: RouteCtx) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await variantsFor(id));
  } catch (error) {
    return failure(error);
  }
}

async function handlePOST(request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  if (typeof body?.key !== "string" || !body.key) return NextResponse.json({ error: "key 가 필요해요" }, { status: 400 });
  try {
    const result = await chooseVariant(id, body.key);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    return failure(error);
  }
}

export async function GET(request: Request, ctx: RouteCtx) {
  return withPersonaRequest(request, () => handleGET(ctx));
}

export async function POST(request: Request, ctx: RouteCtx) {
  return withPersonaRequest(request, () => handlePOST(request, ctx));
}
