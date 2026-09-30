// 제품 페이지 캡처.
//   POST → { ok: true, product, ms } | { ok: false, reason: "bot"|"login"|"region"|"http"|"timeout"|"no-url"|"other", error, ms }
//          (찍기 실패는 200 + ok:false — 사이트가 막은 것이지 요청이 틀린 게 아니다)
//   GET  → 캡처 PNG (없으면 404)
import { NextResponse } from "next/server";
import { currentPersona, withPersonaRequest } from "@/lib/personas/context";
import { readProducts, readProductShot, updateProducts } from "@/lib/personas/products";
import { captureProduct } from "@/lib/personas/products-capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

async function handlePOST(ctx: RouteCtx) {
  const { id } = await ctx.params;
  const persona = currentPersona().id;
  const product = (await readProducts(persona)).find((p) => p.id === id);
  if (!product) return NextResponse.json({ error: "그 제품이 없어요" }, { status: 404 });
  const outcome = await captureProduct(persona, product);
  if (!outcome.ok) return NextResponse.json(outcome);
  const saved = await updateProducts(persona, (list) => {
    const next = list.map((p) => (p.id === id ? { ...p, capture: outcome.capture } : p));
    return { list: next, result: next.find((p) => p.id === id) ?? null };
  });
  return NextResponse.json({ ok: true, product: saved, ms: outcome.ms });
}

async function handleGET(ctx: RouteCtx) {
  const { id } = await ctx.params;
  const persona = currentPersona().id;
  const image = (await readProducts(persona)).find((p) => p.id === id)?.capture?.image;
  const png = image ? await readProductShot(persona, image) : null;
  if (!png) return NextResponse.json({ error: "캡처가 없어요" }, { status: 404 });
  return new NextResponse(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
}

export const POST = (request: Request, ctx: RouteCtx) => withPersonaRequest(request, () => handlePOST(ctx));
export const GET = (request: Request, ctx: RouteCtx) => withPersonaRequest(request, () => handleGET(ctx));
