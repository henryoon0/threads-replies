"use client";

// 답 화면 위 가로 막대: [계정 · 남은 수(lead)] … 찾기 · 새로고침 · ···
// 10-02 픽 "목록 + 스레드 모양 답": 하나씩/5개 한꺼번에·학습·기록·모두 건너뛰기는 ··· 메뉴로, 목록 접기는 뺐다(목록은 늘 편다).

import { HoverHint } from "./hover-hint";
import { ArrowPathIcon } from "@heroicons/react/16/solid";
import { cn } from "@/lib/utils";
import { press } from "./threads-answer-verdict";
import { ThreadsMoreMenu, type MoreSection } from "./threads-more-menu";
import { ThreadsSearch } from "./threads-search";

export type WorkMode = "one" | "batch";

export interface SyncState {
  busy: boolean;
  /** 실패 문구. 있으면 새로고침 옆에 빨갛게 */
  error: string;
  /** "9분 전 동기화" — 새로고침 아이콘의 풍선 글과 ··· 메뉴 아래에 */
  last: string;
  run: () => void;
}

export function ThreadsModeBar({
  lead,
  onPickComment,
  sync,
  menu,
}: {
  /** 왼쪽 끝: 계정 · 남은 수 (workbench 가 넘긴다) */
  lead?: React.ReactNode;
  onPickComment: (id: string) => void;
  sync: SyncState;
  menu: MoreSection[];
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1">
      {lead}
      <span className="ml-auto" />
      {sync.error ? <span className="mr-1 text-[11.5px] text-rose-700">{sync.error}</span> : null}
      <ThreadsSearch onPickComment={onPickComment} />
      <HoverHint label={sync.busy ? "가져오는 중" : sync.last ? `새로고침 · ${sync.last}` : "새로고침"}>
      <button
        type="button"
        onClick={sync.run}
        disabled={sync.busy}
        aria-label="새로고침"
        className={cn("inline-flex size-9 items-center justify-center rounded-[10px] text-neutral-500 hover:bg-neutral-950/[0.04] hover:text-neutral-900 disabled:opacity-60", press)}
      >
        <ArrowPathIcon className={cn("size-4", sync.busy && "animate-spin")} aria-hidden />
      </button>
      </HoverHint>
      <ThreadsMoreMenu sections={menu} />
    </div>
  );
}
