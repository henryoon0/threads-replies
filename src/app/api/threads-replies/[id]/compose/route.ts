// 토글 초안: 켠 조각(공감·드립·원리·성분·제품)만 든 답 하나를 쓰고, 고른 초안(draft = aiDraft)으로 저장한다.
//   POST { toggles: { empathy?, joke?, principle?, ingredient?, product?: { pharmacy?, online?, overseas? } }, base?: string }
//     → { draft, sections: [{ kind, start, end }], sessionId, toggles, answer }
//     products: [{ id, name, url, capture? }] 초안에 이름이 나온 등록 제품
//   preset?: 버전 id → 그 버전 이름·지시를 요청문에 싣는다
//   GET → { toggles, neighbors, presets: [{ id, name, parts, kinds, count, score, recommended, toggles }] }
//         이 계정의 답 버전(주인이 조각을 섞는 방식)을 이 댓글에 맞는 순서로. toggles = 첫 버전.
import { NextResponse } from "next/server";
import { rememberVariant } from "@/lib/threads-replies/compose-variants";
import { withPersonaRequest } from "@/lib/personas/context";
import { composeReply, suggestForReply } from "@/lib/threads-replies/compose-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = /시간 초과|timed? ?out/i.test(message) ? 504 : 500;
  return NextResponse.json({ error: message }, { status });
}

async function handlePOST(request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { toggles?: unknown; base?: unknown; preset?: unknown } | null;
  if (!body) return NextResponse.json({ error: "JSON 본문이 필요해요" }, { status: 400 });
  try {
    const preset = typeof body.preset === "string" ? body.preset : undefined;
    const result = await composeReply(id, { toggles: body.toggles, base: body.base, preset });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    // 누를 때 쓴 버전도 남겨 둔다 — 다시 누르면 새로 쓰지 않고 바로 보인다
    if (preset) {
      const v = { key: preset, toggles: result.toggles, draft: result.draft, sections: result.sections, products: result.products, ms: 0, ...(result.sessionId ? { sessionId: result.sessionId } : {}) };
      await rememberVariant(id, v).catch((e) => console.warn("[compose] 버전 저장 실패:", e instanceof Error ? e.message : e));
    }
    return NextResponse.json(result);
  } catch (error) {
    return failure(error);
  }
}

async function handleGET(ctx: RouteCtx) {
  const { id } = await ctx.params;
  try {
    const result = await suggestForReply(id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, ctx: RouteCtx) {
  return withPersonaRequest(request, () => handlePOST(request, ctx));
}

export async function GET(request: Request, ctx: RouteCtx) {
  return withPersonaRequest(request, () => handleGET(ctx));
}
