"use client";

// 질문 띠 (09-27 픽: 질문 먼저). 스레드 목록 맨 위 한 줄 "답이 필요한 질문 N · 근거 준비 M" + 질문마다 칩.
// 칩을 누르면 목록에서 그 질문이 골라진다. 점 색 = 답할 수 있음 판정 (초록 준비 · 주황 일부 · 회색 모름/아직).

import NumberFlow from "@number-flow/react";
import { QuestionMarkCircleIcon } from "@heroicons/react/16/solid";
import type { AnswerVerdict } from "@/lib/threads-replies/model";
import type { BandQuestion } from "./threads-view";

const MAX_CHIPS = 12;

const DOT: Record<AnswerVerdict | "none", string> = {
  answerable: "bg-emerald-500",
  partial: "bg-amber-500",
  unknown: "bg-neutral-300",
  none: "bg-neutral-950/10",
};

const DOT_LABEL: Record<AnswerVerdict | "none", string> = {
  answerable: "근거 준비됨",
  partial: "일부만 답할 수 있음",
  unknown: "자료로 답하기 어려움",
  none: "초안 준비 중",
};

export function ThreadsQuestionBand({
  items,
  ready,
  selectedId,
  onPick,
}: {
  items: BandQuestion[];
  ready: number;
  selectedId: string | null;
  onPick: (replyId: string) => void;
}) {
  if (!items.length) return null;
  const shown = items.slice(0, MAX_CHIPS);
  return (
    <section aria-label="답이 필요한 질문" className="rounded-xl bg-white ring-1 ring-neutral-950/5">
      <p className="flex items-center gap-2 px-3.5 py-2.5 text-[13px] text-neutral-800">
        <QuestionMarkCircleIcon className="size-4 shrink-0 text-amber-600" />
        <span>
          답이 필요한 질문{" "}
          <b className="tabular-nums">
            <NumberFlow value={items.length} />
          </b>
          <span className="mx-1.5 text-neutral-300">·</span>
          근거 준비{" "}
          <b className="tabular-nums text-emerald-700">
            <NumberFlow value={ready} />
          </b>
        </span>
      </p>
      <div className="flex flex-wrap gap-1.5 px-3.5 pb-3 pt-2.5 shadow-[0_-1px_0_0_rgba(10,10,10,0.05)]">
        {shown.map(({ reply }) => {
          const verdict = reply.answer?.verdict ?? "none";
          const on = reply.id === selectedId;
          return (
            <button
              key={reply.id}
              type="button"
              onClick={() => onPick(reply.id)}
              aria-pressed={on}
              title={`@${reply.username} · ${DOT_LABEL[verdict]}`}
              className={`inline-flex max-w-[15rem] items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-[background-color,color,scale] duration-150 active:scale-[0.97] ${
                on ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-700/15" : "bg-neutral-950/[0.03] text-neutral-600 hover:bg-neutral-950/[0.06]"
              }`}
            >
              <span className={`size-1.5 shrink-0 rounded-full ${DOT[verdict]}`} aria-hidden />
              <span className="shrink-0 font-medium">@{reply.username}</span>
              <span className="truncate">{reply.text}</span>
            </button>
          );
        })}
        {items.length > shown.length ? (
          <span className="self-center px-1 text-[11px] text-neutral-500">외 {items.length - shown.length}개</span>
        ) : null}
      </div>
    </section>
  );
}
