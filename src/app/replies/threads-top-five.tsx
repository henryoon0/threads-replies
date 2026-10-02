"use client";

// 답할 댓글 목록의 한 줄 (시안 픽 7 ib-briefing 의 줄 모양). 10-02 픽으로 "지금 답할 5개 + 나머지" 덩어리는
// 한 줄 목록(threads-queue.tsx)이 됐고, 줄 모양만 여기 남았다. 초안 글 대신 준비 상태(답 준비됨·확인 필요·쓰는 중)만 보인다.

import { memo } from "react";
import { CheckIcon, ClockIcon, EllipsisHorizontalIcon, ExclamationTriangleIcon } from "@heroicons/react/16/solid";
import { cn } from "@/lib/utils";
import { usableDraft } from "@/lib/threads-replies/usable-draft";
import { relativeTime } from "./comments-shared";
import type { GateChecker } from "./threads-gate";
import type { UrgentItem } from "./threads-view";

// 초안 글 대신 준비 상태만 (2026-09-30 henry 시안 픽 quiet): 시간 옆 작은 아이콘 + 한 마디.
// 10-02: 초안이 없으면 다 "쓰는 중"이라 했는데, 실제로 쓰는 건 한 번에 하나뿐이다. 줄 선 것은 "차례 기다림"으로 정직하게.
// 10-02: 기준은 버전 미리 쓰기 줄 — 쓰는 중(running)·차례 기다림(queued). 줄에도 없고 글도 없으면 "준비 전"(보는 곳 20개 밖).
type DraftState = "ready" | "check" | "writing" | "waiting" | "idle";
export type DraftPhase = "writing" | "waiting";
const STATE_LABEL: Record<DraftState, string> = { ready: "답 준비됨", check: "확인 필요", writing: "쓰는 중", waiting: "차례 기다림", idle: "준비 전" };
const STATE_ICON = { ready: CheckIcon, check: ExclamationTriangleIcon, writing: EllipsisHorizontalIcon, waiting: ClockIcon, idle: null } as const;
const STATE_TONE: Record<DraftState, string> = { ready: "text-emerald-700", check: "text-amber-700", writing: "text-emerald-700", waiting: "text-neutral-400", idle: "text-neutral-300" };

function draftStateOf(draft: string, gate: GateChecker, phase: DraftPhase | undefined): DraftState {
  if (phase) return phase;
  if (!draft) return "idle";
  return gate.check(draft).hits.length ? "check" : "ready";
}


function UrgentRowView({
  item,
  selected,
  onSelect,
  gate,
  phase,
}: {
  item: UrgentItem;
  selected: boolean;
  onSelect: (id: string) => void;
  gate: GateChecker;
  /** 미리 쓰기 줄에서의 자리 (없으면 글이 있나로 판단) */
  phase?: DraftPhase;
}) {
  const { reply } = item;
  const state = draftStateOf(usableDraft(reply.answer), gate, phase);
  return (
    // 10-02 픽 r-trim "덜어내기": 번호·'답 준비됨'·'전' 을 뺀다. 준비 안 된 것만 글자로 (10-02 henry: 질문 점도 뺌)
    <button
      type="button"
      data-reply-id={reply.id}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(reply.id)}
      className={rowClass(selected)}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[11.5px]">
        <ReadyDot state={state} />
        <span className="truncate font-medium text-neutral-800">@{reply.username}</span>
        <span className="ml-auto" />
        <StateNote state={state} />
        <span className="shrink-0 tabular-nums text-neutral-400">{shortAgo(reply.timestamp)}</span>
      </span>
      {/* 10-02 henry: 답 내용은 목록에 안 보인다 (답 칸에서 본다). line-clamp 는 display:-webkit-box 라 block 을 같이 쓰면 잘리지 않는다 */}
      <span title={reply.text} className="mt-0.5 line-clamp-2 break-keep text-[12.5px] leading-[1.45] text-neutral-700 [overflow-wrap:anywhere]">{reply.text}</span>
    </button>
  );
}

// 10-02 henry: "새 답" 표시·테두리는 뺐다 (왜 있는지 모르겠다)
function rowClass(selected: boolean): string {
  const tone = selected ? "bg-emerald-50" : "hover:bg-neutral-950/[0.03]";
  return cn("relative w-full rounded-[10px] px-2.5 py-2 text-left transition-[background-color,scale,box-shadow] duration-150 active:scale-[0.99]", tone);
}

/**
 * 이름 앞 점 하나로 상태를 말한다 (10-02 henry: 테두리 빛 애니메이션은 렉이 걸려 뺐다).
 * 답 준비됨 = 초록 점 · 쓰는 중 = 초록 점이 깜빡임 · 확인 필요 = 주황 점. 차례 기다림·준비 전은 점 없음.
 * 점 자리는 늘 잡아 둬서 상태가 바뀌어도 이름이 밀리지 않는다.
 */
function ReadyDot({ state }: { state: DraftState }) {
  const tone = state === "ready" || state === "writing" ? "bg-emerald-500" : state === "check" ? "bg-amber-500" : "bg-transparent";
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", tone, state === "writing" && "animate-pulse")} />;
}

/** 글자는 "확인 필요"만 — 나머지는 점이 말한다 (화면이 덜 바뀌게, 10-02) */
function StateNote({ state }: { state: DraftState }) {
  if (state !== "check") return <span className="sr-only">{STATE_LABEL[state]}</span>;
  const Icon = STATE_ICON.check;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5", STATE_TONE.check)}>
      <Icon className="size-3" aria-hidden />
      {STATE_LABEL.check}
    </span>
  );
}

/** "4일 전" → "4일" */
function shortAgo(iso: string): string {
  return relativeTime(iso).replace(/\s*전$/, "");
}

/**
 * 줄은 바뀐 것만 다시 그린다 (10-02 henry "렉"): 미리 쓰는 동안 3초마다 목록 전체(800여 줄)를 새로 받는데,
 * 받은 객체는 매번 새것이라 내용으로 비교한다.
 */
export const UrgentRow = memo(UrgentRowView, (a, b) => {
  const x = a.item.reply;
  const y = b.item.reply;
  return (
    x.id === y.id &&
    x.text === y.text &&
    x.username === y.username &&
    x.timestamp === y.timestamp &&
    usableDraft(x.answer) === usableDraft(y.answer) &&
    a.selected === b.selected &&
    a.phase === b.phase &&
    a.gate === b.gate &&
    a.onSelect === b.onSelect
  );
});
