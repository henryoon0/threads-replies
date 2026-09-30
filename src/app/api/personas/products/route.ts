// 지금 페르소나의 제품 목록 (팩 private/products.json). 운영자가 직접 넣고 고친다.
//   GET                          → { products }
//   POST   { name, kind, brand?, ingredient?, url?, note? } → { product }
//   PATCH  { id, ...고칠 칸 }    → { product }
//   DELETE ?id=                  → { ok: true }
import { NextResponse } from "next/server";
import { currentPersona, withPersonaRequest } from "@/lib/personas/context";
import { checkPublicUrl } from "@/lib/personas/products-url-guard";
import { newProduct, readProductInput, readProducts, updateProducts, type Product } from "@/lib/personas/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function handleGET() {
  return NextResponse.json({ products: await readProducts(currentPersona().id) });
}

async function handlePOST(request: Request) {
  const input = readProductInput(await request.json().catch(() => null), false);
  if (typeof input === "string") return bad(input);
  const unsafe = input.url ? await checkPublicUrl(input.url) : null;
  if (unsafe) return bad(unsafe);
  const product = newProduct(input);
  await updateProducts(currentPersona().id, (list) => ({ list: [...list, product], result: null }));
  return NextResponse.json({ product });
}

async function handlePATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return bad("id 가 필요해요");
  const input = readProductInput(body, true);
  if (typeof input === "string") return bad(input);
  const unsafe = input.url ? await checkPublicUrl(input.url) : null;
  if (unsafe) return bad(unsafe);
  const product = await updateProducts<Product | null>(currentPersona().id, (list) => {
    const at = list.findIndex((p) => p.id === id);
    if (at < 0) return { list, result: null };
    const next = { ...list[at], ...input };
    return { list: list.map((p, i) => (i === at ? next : p)), result: next };
  });
  return product ? NextResponse.json({ product }) : bad("그 제품이 없어요", 404);
}

async function handleDELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return bad("id 가 필요해요");
  const found = await updateProducts(currentPersona().id, (list) => ({ list: list.filter((p) => p.id !== id), result: list.some((p) => p.id === id) }));
  return found ? NextResponse.json({ ok: true }) : bad("그 제품이 없어요", 404);
}

export const GET = (request: Request) => withPersonaRequest(request, handleGET);
export const POST = (request: Request) => withPersonaRequest(request, () => handlePOST(request));
export const PATCH = (request: Request) => withPersonaRequest(request, () => handlePATCH(request));
export const DELETE = (request: Request) => withPersonaRequest(request, () => handleDELETE(request));
