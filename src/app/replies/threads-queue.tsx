"use client";

// 답할 댓글 목록 (10-02 픽 "한 버튼 메뉴"). 옛 "지금 답할 5개 + 나머지 N개" 두 덩어리를 한 줄 목록으로 합쳤다.
// 머리의 버튼 하나 [오래된 순 ▾] 를 누르면 정렬 2개 (10-02 henry: "질문만"은 뺐다 — 질문을 따로 가를 필요가 없다).
// 줄 모양은 UrgentRow (댓글 두 줄 + 상태 점).
// 10-02: 줄 위 [버전 전부 새로 쓰기] 아이콘은 뺐다 — 답 칸의 [새로 쓰기 · 전부]와 같은 일이고, 목록에서 잘못 누르면 AI 비용만 든다.

import { useState } from "react";
import { CheckIcon, ChevronDownIcon, SparklesIcon } from "@heroicons/react/16/solid";
import type { ThreadsReply } from "@/lib/threads-replies/model";
import { cn } from "@/lib/utils";
import { press } from "./threads-answer-verdict";
import type { GateChecker } from "./threads-gate";
import { useDismiss } from "./threads-more-menu";
import { UrgentRow } from "./threads-top-five";
import type { QueueFilter, QueueSort } from "./threads-view";

const SORT_LABEL: Record<QueueSort, string> = {
  old: "오래된 순",
  new: "최근 순",
};

function FilterMenu({
  filter,
  onFilter,
}: {
  filter: QueueFilter;
  onFilter: (f: QueueFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useDismiss(open, () => setOpen(false));
  const row =
    "flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[12.5px] text-neutral-700 hover:bg-neutral-950/[0.04]";
  const tick = (on: boolean) => (
    <CheckIcon
      className={cn("size-3.5 shrink-0 text-emerald-700", !on && "invisible")}
      aria-hidden
    />
  );
  return (
    <div ref={root} className="relative z-10">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-medium text-neutral-800 ring-1 ring-neutral-950/5 hover:bg-neutral-950/[0.03]",
          open && "bg-neutral-950/[0.04]",
          press,
        )}
      >
        {SORT_LABEL[filter.sort]}
        <ChevronDownIcon
          className={cn(
            "size-3.5 text-neutral-400 transition-transform duration-150",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="목록 순서"
          className="absolute left-0 top-full mt-1.5 w-44 rounded-xl bg-white p-1 shadow-[0_8px_24px_-8px_rgba(10,10,10,0.18)] ring-1 ring-neutral-950/5"
        >
          {(["old", "new"] as const).map((sort) => (
            <button
              key={sort}
              type="button"
              role="menuitemradio"
              aria-checked={filter.sort === sort}
              onClick={() => onFilter({ ...filter, sort })}
              className={row}
            >
              {tick(filter.sort === sort)}
              {SORT_LABEL[sort]}
            </button>
          ))}

        </div>
      ) : null}
    </div>
  );
}

/** 미리 쓰는 20개 중 몇 개가 준비됐나 — 줄마다 글자를 바꾸는 대신 여기 한 줄로 (10-02) */
export interface PrepProgress {
  ready: number;
  total: number;
}

export function ThreadsQueue({
  items,
  progress,
  onMakeBatch,
  filter,
  onFilter,
  selectedId,
  onSelect,
  gate,
  writingIds = [],
  waitingIds = [],
}: {
  items: ThreadsReply[];
  /** 미리 쓰기 진행 — "답 준비 12/20" (오래된 순: 오래된 20개 · 최근 순: [답 20개 만들기]로 맡긴 묶음) */
  progress?: PrepProgress;
  /** 최근 순일 때만: 아직 답이 없는 위쪽 20개를 손으로 맡긴다 (10-02 henry "최근 순은 자동으로 안 쓰고 버튼으로 20개씩") */
  onMakeBatch?: () => void;
  filter: QueueFilter;
  onFilter: (f: QueueFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  gate: GateChecker;
  /** 미리 쓰기 줄: 지금 쓰는 댓글들 · 차례 기다리는 댓글들 */
  writingIds?: string[];
  waitingIds?: string[];
}) {
  return (
    <section
      aria-label="답할 댓글"
      className="rounded-xl bg-white p-1.5 ring-1 ring-neutral-950/5"
    >
      <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-1">
        <FilterMenu filter={filter} onFilter={onFilter} />
        {onMakeBatch ? (
          <button
            type="button"
            onClick={onMakeBatch}
            className={cn("inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-emerald-700 ring-1 ring-neutral-950/5 hover:bg-emerald-50", press)}
          >
            <SparklesIcon className="size-3.5" aria-hidden />
            답 20개 만들기
          </button>
        ) : null}
        <span className="ml-auto text-[11.5px] tabular-nums text-neutral-400">
          {/* 10-02 henry: 오래된 순 20개는 알아서 준비되니 진행 숫자는 안 보인다 — [답 20개 만들기]로 맡긴 묶음만 */}
          {progress && progress.total && onMakeBatch ? (
            <span className={progress.ready < progress.total ? "text-emerald-700" : undefined}>
              답 준비 {progress.ready}/{progress.total} ·{" "}
            </span>
          ) : null}
          {items.length.toLocaleString()}개
        </span>
      </div>
      {items.length ? (
        <ol className="space-y-0.5">
          {items.map((reply) => (
            <li key={reply.id}>
              <UrgentRow
                item={{ reply, reasons: reply.intent === "question" ? ["질문"] : [] }}
                selected={reply.id === selectedId}
                onSelect={onSelect}
                gate={gate}
                phase={writingIds.includes(reply.id) ? "writing" : waitingIds.includes(reply.id) ? "waiting" : undefined}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-3 py-8 text-center text-xs text-neutral-500">
          {filter.questionsOnly ? "남은 질문이 없어요" : "남은 댓글이 없어요"}
        </p>
      )}
    </section>
  );
}
