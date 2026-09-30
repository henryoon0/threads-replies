"use client";

// 비슷한 맥락에서 남긴 글 (09-29 요청 5). 완성된 답 오른쪽에서 주인이 예전에 비슷한 댓글에 단 답을 보여준다.
// 관련성 게이트를 통과한 답만 온다(없으면 빈 패널). 제품 추천이 든 답에는 "제품" 표시를 붙인다. [넣기]는 완성된 답 끝에 붙이고, [복사]는 클립보드로.

import { useEffect, useRef, useState } from "react";
import { ArrowTopRightOnSquareIcon, ClipboardDocumentIcon, PlusIcon } from "@heroicons/react/16/solid";
import { toast } from "@/components/toast";
import type { SimilarItem } from "@/lib/threads-replies/similar";
import { cn } from "@/lib/utils";
import { clearPastFocus, pinFocused, usePastFocus } from "./past-focus";
import { press } from "./threads-answer-verdict";

type State = { status: "loading" } | { status: "done"; items: SimilarItem[] } | { status: "failed" };

function useSimilar(replyId: string): State {
  const [state, setState] = useState<{ id: string; s: State }>({ id: replyId, s: { status: "loading" } });
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/threads-replies/${encodeURIComponent(replyId)}/similar`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { items?: SimilarItem[] }) => setState({ id: replyId, s: { status: "done", items: d.items ?? [] } }))
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ id: replyId, s: { status: "failed" } });
      });
    return () => ctrl.abort();
  }, [replyId]);
  return state.id === replyId ? state.s : { status: "loading" };
}

function Item({ item, onInsert, focused, focusSeq }: { item: SimilarItem; onInsert: (text: string) => void; focused?: boolean; focusSeq?: number }) {
  const ref = useRef<HTMLLIElement>(null);
  // 누를 때마다(seq) 그 칸을 보이는 곳으로 가져온다
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focused, focusSeq]);
  const copy = () => {
    void navigator.clipboard?.writeText(item.text).then(
      () => toast.success("예전 답을 복사했어요"),
      () => toast.error("복사하지 못했어요")
    );
  };
  return (
    <li
      ref={ref}
      aria-current={focused ? "true" : undefined}
      className={cn(
        "py-3 first:pt-1 [&:not(:first-child)]:shadow-[0_-1px_0_0_rgba(10,10,10,0.05)]",
        // 예전 답과 다름 칠하기와 같은 하늘색 — 누른 문장과 짝이라는 표시
        focused && "-mx-2 rounded-xl bg-sky-50 px-2 first:pt-3 ring-1 ring-sky-200 [&:not(:first-child)]:shadow-none"
      )}
    >
      {focused ? <p className="mb-1 text-[10.5px] font-medium text-sky-800">누른 문장과 다른 예전 답</p> : null}
      {item.comment ? <p className="line-clamp-2 text-[11.5px] leading-snug text-neutral-500 break-keep">받은 댓글 · {item.comment}</p> : null}
      <p className="mt-1 whitespace-pre-line text-[13px] leading-[1.6] text-neutral-800 break-keep">{item.text}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-neutral-500">
        {item.product ? <span className="rounded-full bg-emerald-50 px-1.5 py-px font-medium text-emerald-800">제품</span> : null}
        {item.sameCommenter ? <span className="rounded-full bg-neutral-100 px-1.5 py-px">같은 사람</span> : null}
        {item.date ? <span className="tabular-nums">{item.date}</span> : null}
        {item.permalink ? (
          <a href={item.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-neutral-800">
            원문
            <ArrowTopRightOnSquareIcon className="size-3" />
          </a>
        ) : null}
        <span className="ml-auto" />
        <button type="button" onClick={copy} className={cn("inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-neutral-600 hover:bg-neutral-950/[0.04]", press)}>
          <ClipboardDocumentIcon className="size-3.5" />
          복사
        </button>
        <button type="button" onClick={() => onInsert(item.text)} className={cn("inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50", press)}>
          <PlusIcon className="size-3.5" />
          넣기
        </button>
      </div>
    </li>
  );
}

export function SimilarPast({ replyId, onInsert }: { replyId: string; onInsert: (text: string) => void }) {
  const state = useSimilar(replyId);
  const focus = usePastFocus();
  // 다른 댓글로 넘어가면 누른 표시를 지운다
  useEffect(() => clearPastFocus, [replyId]);
  const { items, focusedId } = pinFocused(state.status === "done" ? state.items : [], focus);
  const products = items.filter((i) => i.product).length;
  return (
    <section aria-label="비슷한 맥락에서 남긴 글" className="rounded-[18px] bg-white px-3 pb-1 pt-2.5 ring-1 ring-neutral-950/5">
      <div className="flex items-baseline gap-1.5">
        <h3 className="text-[12.5px] font-semibold text-neutral-900">비슷한 맥락에서 남긴 글</h3>
        {state.status === "done" && items.length ? (
          <span className="text-[11px] tabular-nums text-neutral-500">
            {items.length}개{products ? ` · 제품 ${products}` : ""}
          </span>
        ) : null}
      </div>
      {state.status === "loading" ? (
        <div aria-busy="true" className="space-y-2 py-3">
          <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" />
          <div className="h-3 w-full animate-pulse rounded bg-neutral-100" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-100" />
        </div>
      ) : state.status === "failed" && !focusedId ? (
        <p className="py-3 text-[11.5px] text-neutral-500">예전 답을 찾지 못했어요</p>
      ) : items.length === 0 && !focusedId ? (
        <p className="py-3 text-[11.5px] text-neutral-500">이 댓글과 관련 있는 예전 답이 없어요</p>
      ) : (
        <ul className="mt-1">
          {items.map((it) => (
            <Item key={it.id} item={it} onInsert={onInsert} focused={it.id === focusedId} focusSeq={focus?.seq} />
          ))}
        </ul>
      )}
    </section>
  );
}
