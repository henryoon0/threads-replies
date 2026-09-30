"use client";

// 답에 든 제품 (09-29 henry: "제품 추천도 필요하다면 되어야하고 링크도 있어서 우리 확인용으로 볼 수 있으면 좋아").
// 완성된 답 오른쪽 참고 칸에 둔다. 고른 벌이 알려 준 제품 + 제품 창고(GET /api/personas/products)에서
// 지금 답 글에 이름이 나오는 제품을 합쳐 보여준다. 창고 API 가 없으면(404) 벌이 준 제품만.

import { useEffect, useMemo, useState } from "react";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/16/solid";
import type { VariantProduct } from "./use-compose";

const KIND_LABEL: Record<string, string> = { pharmacy: "약국", online: "온라인", overseas: "직구", 약국: "약국", 온라인: "온라인", 직구: "직구" };

/** 이 계정의 제품 창고 (완성된 답 근거 대조에도 쓴다 — 창고에 적힌 제품 정보는 지어낸 말이 아니다) */
export function useProductLibrary(): VariantProduct[] {
  const [items, setItems] = useState<VariantProduct[]>([]);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/personas/products", { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { products?: VariantProduct[] } | VariantProduct[] | null) => {
        const list = Array.isArray(d) ? d : d?.products;
        if (Array.isArray(list)) setItems(list.filter((p) => p && typeof p.name === "string" && p.name.trim()));
      })
      // 창고가 아직 없으면 벌이 준 제품만 보여준다
      .catch(() => {});
    return () => ctrl.abort();
  }, []);
  return items;
}

/** 벌이 준 제품 먼저, 그다음 답 글에 이름이 나온 창고 제품 (같은 id·이름은 하나로) */
export function mentionedProducts(draft: string, fromVariant: readonly VariantProduct[], library: readonly VariantProduct[]): VariantProduct[] {
  const out: VariantProduct[] = [];
  const seen = new Set<string>();
  const add = (p: VariantProduct) => {
    const k = p.id || p.name;
    if (seen.has(k) || seen.has(p.name)) return;
    seen.add(k);
    seen.add(p.name);
    out.push(p);
  };
  for (const p of fromVariant) if (draft.includes(p.name)) add(p);
  for (const p of library) if (draft.includes(p.name)) add(p);
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ProductRow({ p }: { p: VariantProduct }) {
  const kind = p.kind ? (KIND_LABEL[p.kind] ?? p.kind) : null;
  const body = (
    <>
      {p.capture ? (
        // eslint-disable-next-line @next/next/no-img-element -- 로컬 캡처·외부 이미지 둘 다 받는다
        <img src={p.capture} alt="" className="size-12 shrink-0 rounded-lg object-cover outline outline-1 -outline-offset-1 outline-black/10" />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-neutral-900">{p.name}</span>
          {kind ? <span className="shrink-0 rounded-full bg-neutral-950/[0.05] px-1.5 py-px text-[10.5px] text-neutral-600">{kind}</span> : null}
        </span>
        {p.url ? <span className="mt-0.5 block truncate text-[11px] text-neutral-500">{hostOf(p.url)}</span> : <span className="mt-0.5 block text-[11px] text-neutral-400">링크 없음</span>}
      </span>
      {p.url ? <ArrowTopRightOnSquareIcon className="size-3.5 shrink-0 text-neutral-400 group-hover:text-neutral-700" aria-hidden /> : null}
    </>
  );
  const cls = "group flex items-center gap-2.5 rounded-[10px] p-1.5";
  return p.url ? (
    <a href={p.url} target="_blank" rel="noreferrer" className={`${cls} hover:bg-neutral-950/[0.03]`}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function ThreadsProducts({ draft, fromVariant }: { draft: string; fromVariant: readonly VariantProduct[] }) {
  const library = useProductLibrary();
  const items = useMemo(() => mentionedProducts(draft, fromVariant, library), [draft, fromVariant, library]);
  if (!items.length) return null;
  return (
    <section aria-label="답에 든 제품" className="rounded-[18px] bg-white p-2 ring-1 ring-neutral-950/5">
      <h3 className="px-1.5 pb-1 pt-1 text-[12.5px] font-semibold text-neutral-900">답에 든 제품 {items.length}</h3>
      <ul className="space-y-0.5">
        {items.map((p) => (
          <li key={p.id || p.name}>
            <ProductRow p={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}
