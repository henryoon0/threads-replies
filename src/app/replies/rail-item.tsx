"use client";

// 왼쪽 레일 한 칸 (댓글 · 질문 · 기록).

import type { ComponentType } from "react";
import NumberFlow from "@number-flow/react";
import { motion } from "motion/react";
import { spring } from "@/lib/springs";

function RailCount({ count, sub }: { count: number; sub?: boolean }) {
  return (
    <span
      className={`relative shrink-0 rounded-full px-1.5 text-[10.5px] tabular-nums ${
        count > 0 && !sub ? "bg-emerald-100 text-emerald-700" : "text-neutral-500"
      }`}
    >
      <NumberFlow value={count} />
    </span>
  );
}

export function RailItem({
  active,
  onClick,
  Icon,
  label,
  count,
  hint,
  sub,
  layoutId = "ig-rail-active",
}: {
  active: boolean;
  onClick: () => void;
  Icon?: ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  hint?: string;
  /** 하위 항목(들여쓰기, 작은 글자) */
  sub?: boolean;
  /** 활성 배경이 미끄러질 무리 이름. 레일마다 따로 둔다 */
  layoutId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`relative flex w-full items-center gap-2 rounded-lg text-left transition-[color,background-color,scale] duration-150 active:scale-[0.98] ${
        sub ? "py-1.5 pl-8 pr-2.5 text-xs" : "px-2.5 py-2 text-sm font-medium"
      } ${active ? "text-neutral-900" : "text-neutral-500 hover:bg-neutral-950/[0.03] hover:text-neutral-800"}`}
    >
      {active ? (
        <motion.span
          layoutId={layoutId}
          transition={spring.moderate}
          className="absolute inset-0 rounded-lg bg-white shadow-[0_1px_2px_0_rgba(10,10,10,0.06)] ring-1 ring-neutral-950/5"
        />
      ) : null}
      {Icon ? <Icon className="relative size-4 shrink-0" /> : null}
      <span className="relative min-w-0 flex-1 truncate">
        {label}
        {hint ? <span className="block truncate text-[10.5px] font-normal text-neutral-500">{hint}</span> : null}
      </span>
      {count != null ? <RailCount count={count} sub={sub} /> : null}
    </button>
  );
}
