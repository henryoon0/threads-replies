"use client";

// [인스타 | 스레드] 채널 스위치 (09-27 픽: 채널 스위치). 누르면 왼쪽 레일 전체가 그 채널 것으로 바뀐다.
// 숫자는 채널마다 "지금 답할 댓글" — 인스타는 /api/instagram/summary, 스레드는 /api/threads-replies/summary.

import NumberFlow from "@number-flow/react";
import { motion, useReducedMotion } from "motion/react";
import { spring } from "@/lib/springs";

export type Channel = "instagram" | "threads";

/** 채널 글리프 (브랜드 로고 대신 선 두 개로 그린 표시) */
export function ChannelMark({ channel, size = 13, className = "" }: { channel: Channel; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden className={`shrink-0 ${className}`}>
      {channel === "instagram" ? (
        <>
          <rect x="2" y="2" width="12" height="12" rx="3.5" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="8" r="2.6" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="11.4" cy="4.6" r="0.9" fill="currentColor" />
        </>
      ) : (
        <>
          <path
            d="M11.2 7.3c-.2-2-1.5-3.1-3.3-3.1-2 0-3.3 1.5-3.3 3.8s1.4 3.8 3.4 3.8c1.9 0 3-1.2 3-2.6 0-1.6-1.3-2.4-3-2.4-1.3 0-2.1.7-2.1 1.6 0 .9.8 1.5 1.8 1.5 1.5 0 2.4-1.2 2.4-3.3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path d="M8 14.2A6.2 6.2 0 1 1 14.2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

// 공유 앱은 스레드만 다룬다 — 인스타 칸은 뺀다.
const OPTIONS: { key: Channel; label: string }[] = [{ key: "threads", label: "스레드" }];

export function ChannelSwitch({
  value,
  onChange,
  counts,
}: {
  value: Channel;
  onChange: (c: Channel) => void;
  /** 채널별 답할 댓글 수. 아직 모르면 비운다 (자리는 유지) */
  counts: Partial<Record<Channel, number>>;
}) {
  const reduce = useReducedMotion();
  return (
    <div role="tablist" aria-label="채널" className="flex shrink-0 rounded-[10px] bg-neutral-950/[0.05] p-0.5">
      {OPTIONS.map((o) => {
        const on = o.key === value;
        const count = counts[o.key];
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.key)}
            className={`relative inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-[color,scale] duration-150 active:scale-[0.97] ${
              on ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {on ? (
              <motion.span
                layoutId="channel-switch-active"
                transition={reduce ? { duration: 0 } : spring.moderate}
                className="absolute inset-0 rounded-lg bg-white shadow-[0_1px_2px_0_rgba(10,10,10,0.08)] ring-1 ring-neutral-950/5"
              />
            ) : null}
            <ChannelMark channel={o.key} className="relative" />
            <span className="relative">{o.label}</span>
            <span
              className={`relative min-w-[1.25rem] rounded-full px-1.5 text-center text-[10.5px] tabular-nums ${
                on && count ? "bg-emerald-100 text-emerald-700" : "text-neutral-500"
              }`}
            >
              {count == null ? " " : <NumberFlow value={count} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
