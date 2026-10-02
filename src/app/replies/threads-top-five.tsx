"use client";

// 답할 댓글 목록의 한 줄 (시안 픽 7 ib-briefing 의 줄 모양). 10-02 픽으로 "지금 답할 5개 + 나머지" 덩어리는
// 한 줄 목록(threads-queue.tsx)이 됐고, 줄 모양만 여기 남았다. 초안 글 대신 준비 상태(답 준비됨·확인 필요·쓰는 중)만 보인다.

import { CheckIcon, ClockIcon, EllipsisHorizontalIcon, ExclamationTriangleIcon } from "@heroicons/react/16/solid";
import { BorderBeam } from "@/components/border-beam";
import { cn } from "@/lib/utils";
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


export function UrgentRow({
  item,
  selected,
  onSelect,
  gate,
  phase,
  fresh = false,
}: {
  item: UrgentItem;
  selected: boolean;
  onSelect: (id: string) => void;
  gate: GateChecker;
  /** 미리 쓰기 줄에서의 자리 (없으면 글이 있나로 판단) */
  phase?: DraftPhase;
  /** 보고 있는 사이 답이 막 생겼고 아직 안 열어 봄 → "새 답" (10-02 henry "생성됐다는 티") */
  fresh?: boolean;
}) {
  const { reply } = item;
  const state = draftStateOf(reply.answer?.draft ?? "", gate, phase);
  return (
    // 10-02 픽 r-trim "덜어내기": 번호·'답 준비됨'·'전' 을 뺀다. 준비 안 된 것만 글자로 (10-02 henry: 질문 점도 뺌)
    <button
      type="button"
      data-reply-id={reply.id}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(reply.id)}
      className={rowClass(selected, fresh)}
    >
      {/* 지금 AI 가 이 댓글 답을 쓰는 중 — 박스 테두리를 도는 빛 (10-02 henry "어떤 댓글에서 쓰는 중인지 박스에서") */}
      {state === "writing" ? <BorderBeam radius={10} duration={3} /> : null}
      <span className="flex min-w-0 items-center gap-1.5 text-[11.5px]">
        <ReadyDot state={state} />
        <span className="truncate font-medium text-neutral-800">@{reply.username}</span>
        <FreshChip show={fresh && !selected} />
        <span className="ml-auto" />
        <StateNote state={state} />
        <span className="shrink-0 tabular-nums text-neutral-400">{shortAgo(reply.timestamp)}</span>
      </span>
      {/* line-clamp 는 display:-webkit-box 라 block 을 같이 쓰면 잘리지 않는다 (10-02 7줄까지 다 보이던 원인). 전문은 풍선 글·답 칸에 */}
      <span title={reply.text} className="mt-0.5 line-clamp-2 break-keep text-[12.5px] leading-[1.45] text-neutral-700 [overflow-wrap:anywhere]">{reply.text}</span>
    </button>
  );
}

function rowClass(selected: boolean, fresh: boolean): string {
  const tone = selected ? "bg-emerald-50" : fresh ? "bg-white ring-1 ring-emerald-300 hover:bg-emerald-50/50" : "hover:bg-neutral-950/[0.03]";
  return cn("relative w-full rounded-[10px] px-2.5 py-2 text-left transition-[background-color,scale,box-shadow] duration-150 active:scale-[0.99]", tone);
}

/** 답이 준비된 댓글은 이름 앞 초록 점 — 눌러 볼 수 있다는 표시 (확인 필요는 주황) */
function ReadyDot({ state }: { state: DraftState }) {
  if (state !== "ready" && state !== "check") return null;
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", state === "ready" ? "bg-emerald-500" : "bg-amber-500")} />;
}

/** 보고 있는 사이 막 생긴 답 — 열어 볼 때까지 */
function FreshChip({ show }: { show: boolean }) {
  return show ? <span className="shrink-0 rounded-full bg-emerald-700 px-1.5 py-px text-[10px] font-medium text-white">새 답</span> : null;
}

/** 준비됨은 기본이라 말하지 않는다 — 쓰는 중·차례 기다림·확인 필요만 */
function StateNote({ state }: { state: DraftState }) {
  if (state === "ready") return <span className="sr-only">{STATE_LABEL.ready}</span>;
  const Icon = STATE_ICON[state];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5", STATE_TONE[state])}>
      {Icon ? <Icon className={cn("size-3", state === "writing" && "animate-pulse")} aria-hidden /> : null}
      {STATE_LABEL[state]}
    </span>
  );
}

/** "4일 전" → "4일" */
function shortAgo(iso: string): string {
  return relativeTime(iso).replace(/\s*전$/, "");
}
