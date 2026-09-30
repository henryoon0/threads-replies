"use client";

// 넓게 보기(기본)일 때 목록 대신 쓰는 가로 띠: 지금 답할 5개를 한 줄 알약으로 보여주고, 나머지는 [목록 펴기]로.
// 답 칸 폭을 다 쓰면서도 다음 댓글이 늘 보여 "숨긴 목록"을 잊지 않게 한다 (점진적 공개 + 보이는 단서).

import { cn } from "@/lib/utils";
import { firstLine, type UrgentItem } from "./threads-view";
import { setThreadsWide } from "./use-wide";

export function ThreadsQueueStrip({
  items,
  total,
  selectedId,
  onSelect,
}: {
  items: UrgentItem[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!items.length) return null;
  const rest = total - items.length;
  return (
    <nav aria-label="지금 답할 댓글" className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
      <span className="shrink-0 pr-1 text-[11.5px] font-medium text-neutral-500">지금 답할 {items.length}</span>
      {items.map((u, i) => {
        const on = u.reply.id === selectedId;
        return (
          <button
            key={u.reply.id}
            type="button"
            data-reply-id={u.reply.id}
            aria-current={on ? "true" : undefined}
            onClick={() => onSelect(u.reply.id)}
            title={u.reply.text}
            className={cn(
              "inline-flex h-9 max-w-[18rem] shrink-0 items-center gap-1.5 rounded-full pl-1.5 pr-3 text-[12px] transition-[background-color,scale] duration-150 active:scale-[0.96]",
              on ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-700/20" : "bg-white text-neutral-700 ring-1 ring-neutral-950/5 hover:bg-neutral-50"
            )}
          >
            <span
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold tabular-nums",
                on ? "bg-emerald-700 text-white" : "bg-neutral-950/[0.05] text-neutral-500"
              )}
            >
              {i + 1}
            </span>
            <span className="shrink-0 font-medium">@{u.reply.username}</span>
            {u.reasons.includes("질문") ? <span className="shrink-0 rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-700">질문</span> : null}
            <span className="min-w-0 truncate text-neutral-500">{firstLine(u.reply.text)}</span>
          </button>
        );
      })}
      {rest > 0 ? (
        <button
          type="button"
          onClick={() => setThreadsWide(false)}
          className="inline-flex h-9 shrink-0 items-center rounded-full px-3 text-[12px] font-medium text-emerald-700 hover:bg-emerald-50 active:scale-[0.96]"
        >
          나머지 {rest.toLocaleString()}개
        </button>
      ) : null}
    </nav>
  );
}
