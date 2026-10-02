"use client";

// 머리줄 오른쪽 ··· 메뉴 (10-02 픽 "목록 + 스레드 모양 답").
// 답하는 데 매번 쓰지 않는 것 — 학습 화면, 기록, 보내는 방식, 모두 건너뛰기, 동기화 시각 — 을 여기 모은다.
// 항목은 부르는 쪽이 섹션으로 넘긴다: 칸 이동(학습·기록)은 workbench, 작업 도구는 답 화면이 안다.

import { HoverHint } from "./hover-hint";
import { useEffect, useRef, useState } from "react";
import { CheckIcon, EllipsisHorizontalIcon } from "@heroicons/react/16/solid";
import { cn } from "@/lib/utils";
import { press } from "./threads-answer-verdict";

export interface MoreItem {
  label: string;
  onSelect: () => void;
  /** 고를 수 있는 상태(하나씩/5개처럼)면 체크 표시 */
  checked?: boolean;
}

export interface MoreSection {
  title?: string;
  items: MoreItem[];
  /** 메뉴 맨 아래 흐린 안내 (예: "9분 전 동기화") */
  note?: string;
}

export function useDismiss(open: boolean, close: () => void) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !root.current?.contains(e.target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return root;
}

export function ThreadsMoreMenu({ sections }: { sections: MoreSection[] }) {
  const [open, setOpen] = useState(false);
  const root = useDismiss(open, () => setOpen(false));
  const shown = sections.filter((s) => s.items.length || s.note);
  if (!shown.length) return null;
  return (
    <div ref={root} className="relative z-20">
      <HoverHint label={open ? "" : "더보기 · 학습 · 기록 · 보내는 방식"}>
      <button
        type="button"
        aria-label="더보기"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex size-9 items-center justify-center rounded-[10px] text-neutral-500 hover:bg-neutral-950/[0.04] hover:text-neutral-900",
          open && "bg-neutral-950/[0.05] text-neutral-900",
          press
        )}
      >
        <EllipsisHorizontalIcon className="size-4" aria-hidden />
      </button>
      </HoverHint>
      {open ? (
        <div role="menu" aria-label="더보기" className="absolute right-0 top-full mt-1.5 w-60 rounded-xl bg-white p-1 shadow-[0_8px_24px_-8px_rgba(10,10,10,0.18)] ring-1 ring-neutral-950/5">
          {shown.map((s, i) => (
            <div key={s.title ?? i} className={cn(i > 0 && "mt-1 pt-1 shadow-[0_-1px_0_0_rgba(10,10,10,0.05)]")}>
              {s.title ? <p className="px-2 pb-0.5 pt-1.5 text-[11px] text-neutral-400">{s.title}</p> : null}
              {s.items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                  aria-checked={item.checked}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[12.5px] text-neutral-700 hover:bg-neutral-950/[0.04]"
                >
                  {item.checked !== undefined ? <CheckIcon className={cn("size-3.5 shrink-0 text-emerald-700", !item.checked && "invisible")} aria-hidden /> : null}
                  {item.label}
                </button>
              ))}
              {s.note ? <p className="px-2 pb-1.5 pt-1 text-[11px] text-neutral-400">{s.note}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
