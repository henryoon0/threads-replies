"use client";

// 비슷한 맥락에서 남긴 글 (09-29 요청 5). 완성된 답 오른쪽에서 주인이 예전에 비슷한 댓글에 단 답을 보여준다.
// 관련성 게이트를 통과한 답만 온다(없으면 빈 패널). 제품 추천이 든 답에는 "제품" 표시를 붙인다. [넣기]는 완성된 답 끝에 붙이고, [복사]는 클립보드로.

import { useEffect, useRef, useState } from "react";
import { ArrowTopRightOnSquareIcon, ClipboardDocumentIcon, PlusIcon } from "@heroicons/react/16/solid";
import { toast } from "@/components/toast";
import type { SimilarItem } from "@/lib/threads-replies/similar";
import { cn } from "@/lib/utils";
import { ClampText } from "./clamp-text";
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

export interface SimilarMe {
  handle: string;
  mark: string;
}

function MiniAvatar({ mark, me }: { mark: string; me?: boolean }) {
  return (
    <span aria-hidden className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium", me ? "bg-emerald-700 text-white" : "bg-neutral-200 text-neutral-500")}>
      {mark}
    </span>
  );
}

function Item({ item, me, onInsert, focused, focusSeq }: { item: SimilarItem; me: SimilarMe; onInsert: (text: string) => void; focused?: boolean; focusSeq?: number }) {
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
      {/* 스레드 모양: 받은 댓글 → 대화선 → 내 답 (10-02 henry "실제 스레드 UI 형태로") */}
      {item.comment ? (
        <div className="flex gap-2.5">
          <div className="flex flex-col items-center">
            <MiniAvatar mark="?" />
            <span aria-hidden className="mt-1 w-0.5 flex-1 rounded-full bg-neutral-200" />
          </div>
          <div className="min-w-0 flex-1 pb-2.5">
            <p className="text-[12px] text-neutral-400">받은 댓글{item.date ? ` · ${item.date}` : ""}</p>
            <ClampText text={item.comment} lines={2} className="text-[13px] leading-[1.45] text-neutral-600" />
          </div>
        </div>
      ) : null}
      <div className="flex gap-2.5">
        <MiniAvatar mark={me.mark} me />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-neutral-900">{me.handle}</p>
          <ClampText text={item.text} lines={6} className="text-[13.5px] leading-[1.5] text-neutral-900" />
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[38px] text-[10.5px] text-neutral-500">
        {item.product ? <span className="rounded-full bg-emerald-50 px-1.5 py-px font-medium text-emerald-800">제품</span> : null}
        {item.sameCommenter ? <span className="rounded-full bg-neutral-100 px-1.5 py-px">같은 사람</span> : null}
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

/** 읽는 동안 칸 자리 */
function SimilarSkeleton() {
  return (
    <div aria-busy="true" className="space-y-2 py-3">
      <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" />
      <div className="h-3 w-full animate-pulse rounded bg-neutral-100" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-100" />
    </div>
  );
}

/** 예전 답이 없거나 못 찾았으면 칸을 그리지 않는다 (빈 칸·실패 안내는 정보가 없다, 2026-10-02 henry "불필요한 정보 제거") */
export function SimilarPast({ replyId, me, onInsert }: { replyId: string; me: SimilarMe; onInsert: (text: string) => void }) {
  const state = useSimilar(replyId);
  const focus = usePastFocus();
  // 다른 댓글로 넘어가면 누른 표시를 지운다
  useEffect(() => clearPastFocus, [replyId]);
  const { items, focusedId } = pinFocused(state.status === "done" ? state.items : [], focus);
  const loading = state.status === "loading";
  if (!loading && items.length === 0) return null;
  return (
    <section aria-label="비슷한 맥락에서 남긴 글" className="rounded-[18px] bg-white px-3 pb-1 pt-2.5 ring-1 ring-neutral-950/5">
      <h3 className="text-[12.5px] font-semibold text-neutral-900">비슷한 맥락에서 남긴 글</h3>
      {loading ? (
        <SimilarSkeleton />
      ) : (
        <ul className="mt-1">
          {items.map((it) => (
            <Item key={it.id} item={it} me={me} onInsert={onInsert} focused={it.id === focusedId} focusSeq={focus?.seq} />
          ))}
        </ul>
      )}
    </section>
  );
}
