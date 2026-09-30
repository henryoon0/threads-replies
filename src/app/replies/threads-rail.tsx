"use client";

// 스레드 쪽 위 가로 막대 (09-29 henry: "왼쪽 뷰는 숨겨져도 돼 · 위에 가로로 세팅해서 좁은 느낌이 안 들게").
// 옛 왼쪽 레일(계정 카드 · 댓글/질문/기록 · 학습 4개)을 한 줄로 접었다:
// [계정 ▾] [댓글 N | 질문 N | 기록 N] [학습 ▾] — 학습은 덜 쓰는 화면이라 작은 메뉴 안에 둔다.

import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  AcademicCapIcon,
  ChartBarIcon,
  ChevronDownIcon,
  ClipboardDocumentCheckIcon,
  ScissorsIcon,
} from "@heroicons/react/16/solid";
import type { ThreadsSummary } from "@/lib/threads-replies/summary";
import { cn } from "@/lib/utils";
import { PersonaCard } from "./persona-card";
import { press } from "./threads-answer-verdict";
import { type LearnView, type ThreadsPlace } from "./threads-place";
import type { PersonaListItem } from "./use-persona";

const LEARN_ITEMS: readonly { view: LearnView; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { view: "review", label: "주간 검토", Icon: ClipboardDocumentCheckIcon },
  { view: "rules", label: "규칙 정리", Icon: ScissorsIcon },
  { view: "progress", label: "성과", Icon: ChartBarIcon },
  { view: "voice", label: "말투 재료", Icon: AcademicCapIcon },
];

function Tabs({ s, place, go }: { s: ThreadsSummary | null; place: ThreadsPlace; go: (p: ThreadsPlace) => void }) {
  const tabs = [
    { place: "comments", label: "댓글", count: s?.pending },
    { place: "questions", label: "질문", count: s?.questions },
    { place: "history", label: "기록", count: s?.history },
  ] as const;
  return (
    <div role="tablist" aria-label="스레드 칸" className="inline-flex h-9 items-center rounded-[10px] bg-neutral-950/[0.04] p-0.5">
      {tabs.map((t) => {
        const on = place === t.place;
        return (
          <button
            key={t.place}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => go(t.place)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-medium",
              on ? "bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-950/5" : "text-neutral-500 hover:text-neutral-800",
              press
            )}
          >
            {t.label}
            {t.count != null ? <span className={cn("tabular-nums text-[11.5px]", on ? "text-emerald-700" : "text-neutral-400")}>{t.count.toLocaleString()}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function LearnMenu({ place, go }: { place: ThreadsPlace; go: (p: ThreadsPlace) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const active = LEARN_ITEMS.find((i) => i.view === place);
  return (
    <div ref={root} className="relative z-20">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-medium",
          active ? "bg-emerald-50 text-emerald-800" : "text-neutral-600 hover:bg-neutral-950/[0.04] hover:text-neutral-900",
          press
        )}
      >
        <AcademicCapIcon className="size-4" aria-hidden />
        {active ? `학습 · ${active.label}` : "학습"}
        <ChevronDownIcon className={cn("size-3.5 text-neutral-400 transition-transform duration-150", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div role="menu" aria-label="학습" className="absolute left-0 top-full mt-1.5 w-44 rounded-xl bg-white p-1 shadow-[0_8px_24px_-8px_rgba(10,10,10,0.18)] ring-1 ring-neutral-950/5">
          {LEARN_ITEMS.map((item) => (
            <button
              key={item.view}
              type="button"
              role="menuitemradio"
              aria-checked={place === item.view}
              onClick={() => {
                setOpen(false);
                go(item.view);
              }}
              className={cn(
                "flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[12.5px]",
                place === item.view ? "bg-emerald-50 font-medium text-emerald-800" : "text-neutral-700 hover:bg-neutral-950/[0.04]"
              )}
            >
              <item.Icon className="size-4 text-neutral-400" />
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 계정 · 칸 · 학습. 오른쪽 도구(검색·하나씩/5개·목록)는 답 화면(threads-mode-bar)이 이어 붙인다. */
export function ThreadsNav({
  summary,
  place,
  go,
  persona,
}: {
  summary: ThreadsSummary | null;
  place: ThreadsPlace;
  go: (p: ThreadsPlace) => void;
  persona: { current: PersonaListItem | null; list: PersonaListItem[]; onSwitch: (id: string) => void };
}) {
  return (
    <nav aria-label="스레드 채널" className="flex flex-wrap items-center gap-2">
      <PersonaCard compact current={persona.current} list={persona.list} onSwitch={persona.onSwitch} />
      <Tabs s={summary} place={place} go={go} />
      <LearnMenu place={place} go={go} />
    </nav>
  );
}
