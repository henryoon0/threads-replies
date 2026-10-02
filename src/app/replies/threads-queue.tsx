"use client";

// 답할 댓글 목록 (10-02 픽 "한 버튼 메뉴"). 옛 "지금 답할 5개 + 나머지 N개" 두 덩어리를 한 줄 목록으로 합쳤다.
// 머리의 버튼 하나 [오래된 순 ▾] 를 누르면 정렬 2개 + 질문만. 줄 모양은 지금 답할 5개(UrgentRow) 그대로.
// 10-02: 줄 위 [버전 전부 새로 쓰기] 아이콘은 뺐다 — 답 칸의 [새로 쓰기 · 전부]와 같은 일이고, 목록에서 잘못 누르면 AI 비용만 든다.

import { Fragment, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "@heroicons/react/16/solid";
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
        {filter.questionsOnly ? (
          <span className="text-emerald-700">· 질문만</span>
        ) : null}
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
          <div className="my-1 shadow-[0_-1px_0_0_rgba(10,10,10,0.05)]" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={filter.questionsOnly}
            onClick={() =>
              onFilter({ ...filter, questionsOnly: !filter.questionsOnly })
            }
            className={row}
          >
            {tick(filter.questionsOnly)}
            질문만
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 보고 있는 사이 답이 생긴 댓글 (10-02 henry "생성되면 생성됐다는 느낌") — 열어 보면 지운다.
 * 처음 그릴 때 이미 준비된 댓글은 "새 답"이 아니다.
 */
function useFreshReady(
  items: ThreadsReply[],
  selectedId: string | null,
): Set<string> {
  const key = items
    .filter((r) => r.answer?.draft)
    .map((r) => r.id)
    .join("\n");
  const [st, setSt] = useState<{ key: string | null; fresh: Set<string> }>({
    key: null,
    fresh: new Set(),
  });
  // 그리는 중에 지난 값과 비교해 고친다 (useSelection 과 같은 방식 — effect 에서 setState 하지 않는다)
  if (st.key !== key) {
    const before = new Set(st.key ? st.key.split("\n") : []);
    const added =
      st.key === null
        ? []
        : (key ? key.split("\n") : []).filter((id) => !before.has(id));
    setSt({
      key,
      fresh: added.length ? new Set([...st.fresh, ...added]) : st.fresh,
    });
  } else if (selectedId && st.fresh.has(selectedId)) {
    setSt({
      key,
      fresh: new Set([...st.fresh].filter((id) => id !== selectedId)),
    });
  }
  return st.fresh;
}

/** 칸 머리: "답 준비됨 · 7" / "준비 중 · 13" */
function SectionHead({ label, count }: { label: string; count: number }) {
  return (
    <li
      aria-hidden
      className="flex items-center gap-1.5 px-2.5 pb-1 pt-2.5 text-[11px] font-medium text-neutral-400"
    >
      {label}
      <span className="tabular-nums">· {count.toLocaleString()}</span>
    </li>
  );
}

export function ThreadsQueue({
  items,
  readyCount,
  filter,
  onFilter,
  selectedId,
  onSelect,
  gate,
  writingIds = [],
  waitingIds = [],
}: {
  items: ThreadsReply[];
  /** items 앞에서 몇 개가 "답 준비됨" 칸인가 (나머지는 "준비 중") — 없으면 칸을 나누지 않는다 */
  readyCount?: number;
  filter: QueueFilter;
  onFilter: (f: QueueFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  gate: GateChecker;
  /** 미리 쓰기 줄: 지금 쓰는 댓글들 · 차례 기다리는 댓글들 */
  writingIds?: string[];
  waitingIds?: string[];
}) {
  const fresh = useFreshReady(items, selectedId);
  return (
    <section
      aria-label="답할 댓글"
      className="rounded-xl bg-white p-1.5 ring-1 ring-neutral-950/5"
    >
      <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-1">
        <FilterMenu filter={filter} onFilter={onFilter} />
        <span className="ml-auto text-[11.5px] tabular-nums text-neutral-400">
          {items.length.toLocaleString()}개
        </span>
      </div>
      {items.length ? (
        <ol className="space-y-0.5">
          {items.map((reply, i) => (
            <Fragment key={reply.id}>
              {readyCount !== undefined && i === 0 && readyCount > 0 ? (
                <SectionHead label="답 준비됨" count={readyCount} />
              ) : null}
              {readyCount !== undefined && i === readyCount ? (
                <SectionHead
                  label="준비 중"
                  count={items.length - readyCount}
                />
              ) : null}
              <li>
                <UrgentRow
                  item={{
                    reply,
                    reasons: reply.intent === "question" ? ["질문"] : [],
                  }}
                  selected={reply.id === selectedId}
                  onSelect={onSelect}
                  gate={gate}
                  phase={
                    writingIds.includes(reply.id)
                      ? "writing"
                      : waitingIds.includes(reply.id)
                        ? "waiting"
                        : undefined
                  }
                  fresh={fresh.has(reply.id)}
                />
              </li>
            </Fragment>
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
