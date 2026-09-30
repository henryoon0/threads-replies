"use client";

// 학습 화면 공용 조각: 머리글, 키 표시, 규칙책 크기 막대, 불러오는 중·오류 칸.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function LearnHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-neutral-900">{title}</h2>
        {sub ? <p className="mt-0.5 text-[12.5px] text-neutral-500">{sub}</p> : null}
      </div>
      {right ? <div className="ml-auto flex items-center gap-3">{right}</div> : null}
    </header>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-white/20 px-1 font-sans text-[10.5px] font-medium", className)}>
      {children}
    </kbd>
  );
}

/** 규칙책 크기 / 한도. next 를 주면 적용 뒤 크기를 옅게 겹쳐 보여 준다. */
export function TokenGauge({ used, cap, next, className }: { used: number; cap: number; next?: number; className?: string }) {
  const w = (n: number) => `${Math.min(100, Math.max(0, (n / Math.max(cap, 1)) * 100))}%`;
  const over = (next ?? used) > cap;
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2 text-[11.5px] tabular-nums">
        <span className="text-neutral-500">규칙책 크기</span>
        <span className={over ? "font-medium text-amber-700" : "text-neutral-700"}>
          {(next ?? used).toLocaleString()} / {cap.toLocaleString()} 토큰
        </span>
      </div>
      <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-950/[0.06]" role="meter" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={next ?? used} aria-label="규칙책 크기">
        {next !== undefined && next > used ? <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-500/35" style={{ width: w(next) }} /> : null}
        <div className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-amber-500" : "bg-neutral-800")} style={{ width: w(Math.min(used, next ?? used)) }} />
      </div>
    </div>
  );
}

export function LearnLoading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="불러오는 중">
      <div className="h-6 w-40 animate-pulse rounded-md bg-neutral-950/[0.05]" />
      <div className="h-64 animate-pulse rounded-2xl bg-neutral-950/[0.04]" />
    </div>
  );
}

export function LearnError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900 ring-1 ring-amber-900/10">
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="shrink-0 rounded-lg px-2 py-1 font-medium hover:bg-amber-900/5">
          다시 불러오기
        </button>
      ) : null}
    </div>
  );
}

export const btnPrimary =
  "inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-700 pl-3.5 pr-2.5 text-[13px] font-medium text-white transition-[background-color,scale] duration-150 hover:bg-emerald-800 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50";
export const btnQuiet =
  "inline-flex h-10 items-center gap-2 rounded-xl bg-neutral-950/[0.05] pl-3.5 pr-2.5 text-[13px] font-medium text-neutral-700 transition-[background-color,scale] duration-150 hover:bg-neutral-950/[0.08] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50";
