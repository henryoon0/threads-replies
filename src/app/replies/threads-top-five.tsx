"use client";

// 지금 답할 5개 (시안 픽 7 ib-briefing). 질문 → 관문 걸림 → 오래 기다린 순 5개만 위에 펴 두고,
// 나머지는 "나머지 N개"로 접는다. 행에는 초안 글 대신 준비 상태(답 준비됨·확인 필요·쓰는 중)만 보인다.

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowPathIcon, CheckIcon, ChevronRightIcon, EllipsisHorizontalIcon, ExclamationTriangleIcon } from "@heroicons/react/16/solid";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { relativeTime } from "./comments-shared";
import type { GateChecker } from "./threads-gate";
import type { UrgentItem, UrgentReason } from "./threads-view";
import { restartMany, useTopFive } from "./regen-scope";

// 초안 글 대신 준비 상태만 (2026-09-30 henry 시안 픽 quiet): 시간 옆 작은 아이콘 + 한 마디.
type DraftState = "ready" | "check" | "writing";
const STATE_LABEL: Record<DraftState, string> = { ready: "답 준비됨", check: "확인 필요", writing: "쓰는 중" };
const STATE_ICON = { ready: CheckIcon, check: ExclamationTriangleIcon, writing: EllipsisHorizontalIcon } as const;
const STATE_TONE: Record<DraftState, string> = { ready: "text-emerald-700", check: "text-amber-700", writing: "text-neutral-500" };

const REASON_TONE: Record<UrgentReason, string> = {
  질문: "bg-amber-50 text-amber-700 font-medium",
  관문: "bg-stone-100 text-stone-600",
  "오래 기다림": "bg-neutral-100 text-neutral-500",
};
const REASON_LABEL: Record<UrgentReason, string> = { 질문: "질문", 관문: "관문 확인", "오래 기다림": "오래 기다림" };

function Row({ item, n, selected, onSelect, gate }: { item: UrgentItem; n: number; selected: boolean; onSelect: (id: string) => void; gate: GateChecker }) {
  const { reply } = item;
  const draft = reply.answer?.draft ?? "";
  const state: DraftState = !draft ? "writing" : gate.check(draft).hits.length ? "check" : "ready";
  const StateIcon = STATE_ICON[state];
  return (
    <button
      type="button"
      data-reply-id={reply.id}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(reply.id)}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-[10px] px-2 py-2 text-left transition-[background-color,scale] duration-150 active:scale-[0.99]",
        selected ? "bg-emerald-50" : "hover:bg-neutral-950/[0.03]"
      )}
    >
      <span
        className={cn(
          "mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold tabular-nums",
          selected ? "bg-emerald-700 text-white" : "bg-neutral-950/[0.05] text-neutral-500"
        )}
      >
        {n}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
          <span className="truncate font-medium text-neutral-800">@{reply.username}</span>
          {/* 기다린 시간은 오른쪽 숫자가 말해 준다 — 칩은 질문·관문만 */}
          {item.reasons.filter((r) => r !== "오래 기다림").map((r) => (
            <span key={r} className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", REASON_TONE[r])}>
              {REASON_LABEL[r]}
            </span>
          ))}
          <span className={cn("ml-auto inline-flex shrink-0 items-center gap-0.5", STATE_TONE[state])}>
            <StateIcon className="size-3" aria-hidden />
            <span>{STATE_LABEL[state]}</span>
          </span>
          <span className="shrink-0 tabular-nums text-neutral-500">{relativeTime(reply.timestamp)}</span>
        </span>
        <span className="mt-0.5 line-clamp-2 block break-keep text-xs leading-relaxed text-neutral-700">{reply.text}</span>
      </span>
    </button>
  );
}

export function ThreadsTopFive({
  items,
  selectedId,
  onSelect,
  gate,
}: {
  items: UrgentItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  gate: GateChecker;
}) {
  const top = useTopFive();
  if (!items.length) return null;
  const ids = items.map((i) => i.reply.id);
  return (
    <section aria-label="지금 답할 댓글" className="rounded-xl bg-white p-1.5 ring-1 ring-neutral-950/5">
      <div className="flex items-baseline gap-2 px-2 pb-1.5 pt-1">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-neutral-900">지금 답할 {items.length}개</h2>
        <p className="min-w-0 truncate text-[11px] text-neutral-500">질문 → 관문 걸림 → 오래 기다린 순</p>
        <button
            type="button"
            disabled={top.busy}
            onClick={() => void restartMany(ids)}
            title={`${items.length}개 댓글의 미리 쓴 버전을 전부 버리고 다시 써요`}
            className="ml-auto inline-flex shrink-0 items-center gap-1 self-center rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-40"
          >
            <ArrowPathIcon className={cn("size-3", top.busy && "animate-spin")} aria-hidden />
            {items.length}개 전부
          </button>
      </div>
      <p aria-live="polite" className={cn("px-2 text-[11px] text-emerald-700", top.note ? "pb-1.5" : "sr-only")}>
        {top.note}
      </p>
      <ol className="space-y-0.5">
        {items.map((item, i) => (
          <li key={item.reply.id} className="group relative">
            <Row item={item} n={i + 1} selected={item.reply.id === selectedId} onSelect={onSelect} gate={gate} />
            <button
                type="button"
                disabled={top.busy}
                onClick={() => void restartMany([item.reply.id])}
                aria-label={`@${item.reply.username} 댓글 버전 전부 새로 쓰기`}
                title="이 댓글의 버전 전부를 버리고 다시 써요"
                className="absolute bottom-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-md bg-white text-neutral-500 opacity-0 shadow-sm ring-1 ring-neutral-950/5 hover:text-emerald-700 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-40"
              >
                <ArrowPathIcon className="size-3.5" aria-hidden />
              </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 나머지 댓글 접기. 고른 댓글이 접힌 쪽에 있으면 펴 둔다. */
export function RestFold({ count, forceOpen, children }: { count: number; forceOpen: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const shown = open || forceOpen;
  if (count <= 0) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={shown}
        className="flex h-9 w-full items-center gap-1.5 rounded-[10px] bg-neutral-950/[0.03] px-3 text-left text-[12.5px] text-neutral-600 transition-[background-color] duration-150 hover:bg-neutral-950/[0.05]"
      >
        <ChevronRightIcon className={cn("size-4 text-neutral-400 transition-transform duration-150", shown && "rotate-90")} aria-hidden />
        나머지 <b className="tabular-nums text-neutral-900">{count.toLocaleString()}</b>개
        <span className="ml-auto text-[11px] text-neutral-500">{shown ? "접기" : "펴기"}</span>
      </button>
      <AnimatePresence initial={false}>
        {shown ? (
          <motion.div
            key="rest"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: spring.moderate.exit }}
            transition={spring.moderate}
            className="pt-2"
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
