"use client";

// 답 화면 위 가로 막대: [계정·칸·학습(lead)] … 검색(/) · 하나씩 / 5개 한꺼번에 · 목록 펴기/접기.
// 09-29 henry: 넓게 보기가 기본. 목록은 필요할 때만 편다.

import { ArrowsPointingOutIcon, QueueListIcon } from "@heroicons/react/16/solid";
import { cn } from "@/lib/utils";
import { press } from "./threads-answer-verdict";
import { ThreadsSearch } from "./threads-search";
import { setThreadsWide } from "./use-wide";

export type WorkMode = "one" | "batch";

export function ThreadsModeBar({
  mode,
  onMode,
  wide,
  onPickComment,
  batchable,
  lead,
}: {
  /** 왼쪽 끝: 계정 · 댓글/질문/기록 · 학습 (workbench 가 넘긴다) */
  lead?: React.ReactNode;
  mode: WorkMode;
  onMode: (m: WorkMode) => void;
  wide: boolean;
  onPickComment: (id: string) => void;
  /** 기록 칸처럼 답할 댓글이 없는 곳에선 5개 한꺼번에를 숨긴다 */
  batchable: boolean;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {lead}
      <span className="ml-auto" />
      <ThreadsSearch onPickComment={onPickComment} />
      {batchable ? (
        <div role="radiogroup" aria-label="작업 방식" className="inline-flex h-9 items-center rounded-[10px] bg-neutral-950/[0.04] p-0.5">
          {(
            [
              ["one", "하나씩"],
              ["batch", "5개 한꺼번에"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => onMode(m)}
              className={cn(
                "h-8 rounded-[8px] px-3 text-[12px] font-medium",
                mode === m ? "bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-950/5" : "text-neutral-500 hover:text-neutral-800",
                press
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setThreadsWide(!wide)}
        aria-pressed={wide}
        className={cn("inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-medium text-neutral-600 ring-1 ring-neutral-950/10 hover:bg-neutral-950/[0.03] hover:text-neutral-900", press)}
      >
        {wide ? <QueueListIcon className="size-3.5" /> : <ArrowsPointingOutIcon className="size-3.5" />}
        {wide ? "목록 펴기" : "목록 접기"}
      </button>
    </div>
  );
}
