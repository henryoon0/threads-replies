// 페르소나별 제품 목록 (2026-09-29 박약사 운영자: "제품 정보는 우리가 직접 넣는다").
//
// 팩 private/products.json 에 둔다. 토글 초안이 제품 조각을 쓸 때 이 목록에서 성분이 맞는 제품을 먼저 권하고,
// 초안에 이름이 나온 제품을 링크·캡처와 함께 화면에 돌려준다 (주인이 링크를 눌러 확인).
// 위쪽은 순수(검증·매칭), 아래 "파일" 절만 I/O.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProductChannel } from "@/lib/threads-replies/compose-kinds";
import type { PersonaId } from "./model";
import { packPrivateDir } from "./registry";

export const PRODUCT_KINDS = ["pharmacy", "online", "overseas"] as const satisfies readonly ProductChannel[];
export type ProductKind = ProductChannel;

export interface ProductCapture {
  /** 팩 private/product-shots/ 안 파일 이름. 화면은 GET /api/personas/products/[id]/capture 로 본다. */
  image: string;
  capturedAt: string;
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  ingredient: string;
  kind: ProductKind;
  url: string;
  note: string;
  capture?: ProductCapture;
}

export interface ProductsFile {
  version: 1;
  products: Product[];
}

// ── 검증 (순수) ─────────────────────────────────────────────────────

const TEXT_FIELDS = ["name", "brand", "ingredient", "url", "note"] as const;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function validUrl(url: string): boolean {
  if (!url) return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

type ProductInput = Partial<Omit<Product, "id" | "capture">>;

function readKind(o: Record<string, unknown>, out: ProductInput): string | null {
  if (!("kind" in o)) return null;
  if (!(PRODUCT_KINDS as readonly string[]).includes(String(o.kind))) return "kind 는 pharmacy·online·overseas 중 하나예요";
  out.kind = o.kind as ProductKind;
  return null;
}

function requiredError(out: ProductInput, partial: boolean): string | null {
  if (partial) return "name" in out && !out.name ? "name 을 비울 수 없어요" : null;
  if (!out.name) return "name 이 필요해요";
  return out.kind ? null : "kind 가 필요해요";
}

/** 요청 본문 → 고칠 칸만. 잘못된 값이면 오류 문자열. partial=false 면 name·kind 필수. */
export function readProductInput(raw: unknown, partial: boolean): ProductInput | string {
  if (!raw || typeof raw !== "object") return "JSON 본문이 필요해요";
  const o = raw as Record<string, unknown>;
  const out: ProductInput = {};
  for (const k of TEXT_FIELDS) if (k in o) out[k] = str(o[k]);
  const kindError = readKind(o, out);
  if (kindError) return kindError;
  if (out.url && !validUrl(out.url)) return "url 이 http(s) 주소가 아니에요";
  return requiredError(out, partial) ?? out;
}

export function newProduct(input: Partial<Omit<Product, "id" | "capture">>, id = randomUUID().slice(0, 8)): Product {
  return {
    id,
    name: input.name ?? "",
    brand: input.brand ?? "",
    ingredient: input.ingredient ?? "",
    kind: input.kind ?? "pharmacy",
    url: input.url ?? "",
    note: input.note ?? "",
  };
}

// ── 매칭 (순수) ─────────────────────────────────────────────────────

function norm(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/\s+/g, "");
}

/** 성분 이름 쪼개기: "철분(비스글리시네이트)" → ["철분", "비스글리시네이트"] */
function ingredientTerms(p: Product): string[] {
  return p.ingredient
    .split(/[,/()·\s]+/)
    .map(norm)
    .filter((t) => t.length >= 2);
}

/** 토글 초안에 권할 제품: 켠 경로의 제품 가운데 성분이 글(댓글·맥락)에 나온 것 먼저. 최대 max 개. */
export function productsForPrompt(products: readonly Product[], channels: readonly ProductKind[], text: string, max = 4): Product[] {
  const t = norm(text);
  const hits = (p: Product) => ingredientTerms(p).filter((term) => t.includes(term)).length;
  return products
    .filter((p) => channels.includes(p.kind))
    .map((p) => ({ p, h: hits(p) }))
    .sort((a, b) => b.h - a.h)
    .slice(0, max)
    .map((x) => x.p);
}

/** 이름에서 뽑은 매칭 열쇠: 전체 이름, 그리고 브랜드를 뺀 이름 (둘 다 공백 무시). */
function nameKeys(p: Product): string[] {
  const full = norm(p.name);
  const noBrand = p.brand ? norm(p.name.replace(p.brand, "")) : "";
  return [full, noBrand].filter((k) => k.length >= 3);
}

/** 초안에 이름이 나온 제품 (글 등장 순). */
export function productsInDraft(draft: string, products: readonly Product[]): Product[] {
  const d = norm(draft);
  return products
    .map((p) => ({ p, at: Math.min(...nameKeys(p).map((k) => (d.includes(k) ? d.indexOf(k) : Infinity))) }))
    .filter((x) => Number.isFinite(x.at))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.p);
}

export interface ProductRef {
  id: string;
  name: string;
  url: string;
  capture?: ProductCapture;
}

export function toRef(p: Product): ProductRef {
  return { id: p.id, name: p.name, url: p.url, ...(p.capture ? { capture: p.capture } : {}) };
}

// ── 파일 ────────────────────────────────────────────────────────────

export function productsPath(id: PersonaId): string {
  return path.join(packPrivateDir(id), "products.json");
}

export function productShotsDir(id: PersonaId): string {
  return path.join(packPrivateDir(id), "product-shots");
}

export async function readProducts(id: PersonaId): Promise<Product[]> {
  try {
    const raw = JSON.parse(await readFile(productsPath(id), "utf8")) as Partial<ProductsFile>;
    return Array.isArray(raw.products) ? raw.products : [];
  } catch {
    return [];
  }
}

async function writeProducts(id: PersonaId, products: readonly Product[]): Promise<void> {
  const file = productsPath(id);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ version: 1, products: [...products] } satisfies ProductsFile, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

function locks(): Map<string, Promise<unknown>> {
  const g = globalThis as typeof globalThis & { __productLocks?: Map<string, Promise<unknown>> };
  g.__productLocks ??= new Map();
  return g.__productLocks;
}

/** 읽고-고치고-쓰기를 페르소나마다 한 줄로. fn 이 목록과 결과를 돌려준다. */
export function updateProducts<T>(id: PersonaId, fn: (list: Product[]) => { list: Product[]; result: T }): Promise<T> {
  const tail = locks().get(id) ?? Promise.resolve();
  const run = tail.then(async () => {
    const { list, result } = fn(await readProducts(id));
    await writeProducts(id, list);
    return result;
  });
  locks().set(id, run.catch(() => undefined));
  return run;
}

/** 캡처 파일 읽기 (없거나 이름이 이상하면 null). */
export async function readProductShot(id: PersonaId, image: string): Promise<Buffer | null> {
  if (!/^[A-Za-z0-9_.-]+\.png$/.test(image)) return null;
  try {
    return await readFile(path.join(productShotsDir(id), image));
  } catch {
    return null;
  }
}
