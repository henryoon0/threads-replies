"use client";

// 레일 위 계정 카드 (시안 픽 1 "레일 위 계정 카드", /prototypes/persona-replies?step=persona-pick&v=2).
// 지금 어느 계정으로 답하는지 늘 보이고, 누르면 팩 목록이 펼쳐진다. 팩이 하나뿐이면 전환 장치 없이 카드만.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckIcon, ChevronUpDownIcon } from "@heroicons/react/16/solid";
import { cn } from "@/lib/utils";
import type { PersonaListItem } from "./use-persona";

/** 아바타 한 글자. 박약사는 지금 /supplement 의 "약" 아바타와 같게. */
const MARKS: Record<string, string> = {};

function Mark({ p, size = "md" }: { p: Pick<PersonaListItem, "id" | "name">; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white",
        p.id === "me" ? "bg-neutral-900" : "bg-emerald-700",
        size === "md" ? "size-8 text-[12px]" : "size-6 text-[10.5px]"
      )}
    >
      {MARKS[p.id] ?? p.name.slice(0, 1)}
    </span>
  );
}

function sendNote(p: PersonaListItem): string {
  if (p.send === "copy" || !p.hasToken) return "토큰 없음 · 복사해서 달기";
  return p.gate === "strict" ? "엄격한 관문" : "바로 보내기";
}

function PersonaRow({ p, active, onPick }: { p: PersonaListItem; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onPick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-neutral-950/[0.04]"
    >
      <Mark p={p} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-neutral-900">{p.name}</span>
        <span className="block truncate text-[11px] text-neutral-500">
          @{p.handle} · {sendNote(p)}
        </span>
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">{p.summary.pending}</span>
      <CheckIcon className={cn("size-3.5 shrink-0 text-emerald-700", active ? "opacity-100" : "opacity-0")} aria-hidden />
    </button>
  );
}

function Trigger({ current, canSwitch, open, compact, onClick }: { current: PersonaListItem; canSwitch: boolean; open: boolean; compact: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={!canSwitch}
      aria-haspopup={canSwitch ? "menu" : undefined}
      aria-expanded={canSwitch ? open : undefined}
      onClick={onClick}
      className={cn(
        "flex items-center text-left ring-1 ring-neutral-950/5 transition-[background-color,scale] duration-150 enabled:hover:bg-neutral-50 enabled:active:scale-[0.98]",
        compact ? "h-9 gap-2 rounded-[10px] bg-white pl-1.5 pr-2" : "w-full gap-2.5 rounded-xl bg-white px-2.5 py-2.5"
      )}
    >
      <Mark p={current} size={compact ? "sm" : "md"} />
      {compact ? (
        <span className="max-w-[10rem] truncate text-[13px] font-medium text-neutral-900">{current.name}</span>
      ) : (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-neutral-900">{current.name}</span>
          <span className="block truncate text-[11px] text-neutral-500">@{current.handle}</span>
        </span>
      )}
      {canSwitch ? <ChevronUpDownIcon className="size-4 shrink-0 text-neutral-400" aria-hidden /> : null}
    </button>
  );
}

export function PersonaCard({
  current,
  list,
  onSwitch,
  compact = false,
}: {
  current: PersonaListItem | null;
  list: PersonaListItem[];
  onSwitch: (id: string) => void;
  /** 위 가로 막대용 한 줄 (09-29 레일 → 가로 막대) */
  compact?: boolean;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const canSwitch = list.length > 1;

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

  if (!current) return <div className={cn("rounded-xl bg-white ring-1 ring-neutral-950/5", compact ? "h-9 w-40" : "h-[52px]")} aria-hidden />;

  return (
    <div ref={root} className="relative z-20">
      <Trigger current={current} canSwitch={canSwitch} open={open} compact={compact} onClick={() => setOpen((v) => !v)} />
      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            aria-label="답할 계정"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -2 }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            style={{ transformOrigin: "top center" }}
            className={cn(
              "absolute top-full mt-1.5 rounded-xl bg-white p-1 shadow-[0_8px_24px_-8px_rgba(10,10,10,0.18)] ring-1 ring-neutral-950/5",
              compact ? "left-0 w-72" : "inset-x-0"
            )}
          >
            {list.map((p) => (
              <PersonaRow
                key={p.id}
                p={p}
                active={p.id === current.id}
                onPick={() => {
                  setOpen(false);
                  if (p.id !== current.id) onSwitch(p.id);
                }}
              />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
