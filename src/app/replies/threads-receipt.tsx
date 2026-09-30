"use client";

// 학습에서 빼기 (시안 픽 15 lr-exclude). 보낸(단) 답 아래 영수증 한 줄
// "초안에서 N자 고침 · 학습에 기록됨" + [학습에 쓰기] 스위치. 끄면 PATCH /learn { learn:false }.
// 보낸 직후엔 패널이 다음 댓글로 넘어가므로, 화면 아래 영수증 띠(ReceiptDock)로 한 번 더 보여준다.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { Switch } from "@/components/ui/switch";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { press } from "./threads-answer-verdict";

export interface LearnEntry {
  aiDraft: string | null;
  final: string | null;
  learn: boolean;
  gate: "pass" | "check" | "block" | null;
}

/** 글자(코드 포인트) 단위로 몇 글자를 고쳤나 (편집 거리) */
export function editedChars(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}

export function receiptText(e: LearnEntry): string {
  const n = e.aiDraft != null && e.final != null ? editedChars(e.aiDraft, e.final) : null;
  const head = n == null ? "직접 쓴 답" : n === 0 ? "초안 그대로" : `초안에서 ${n}자 고침`;
  return `${head} · ${e.learn ? "학습에 기록됨" : "학습에서 뺐어요"}`;
}

function useLearnEntry(replyId: string) {
  const [entry, setEntry] = useState<LearnEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`/api/threads-replies/${encodeURIComponent(replyId)}/learn`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ entry: LearnEntry }>) : null))
      .then((d) => {
        if (alive && d?.entry) setEntry(d.entry);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [replyId]);
  const toggle = useCallback(async () => {
    if (!entry || busy) return;
    const learn = !entry.learn;
    setBusy(true);
    setError(null);
    setEntry({ ...entry, learn });
    try {
      const res = await fetch(`/api/threads-replies/${encodeURIComponent(replyId)}/learn`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ learn }),
      });
      const body = (await res.json().catch(() => ({}))) as { entry?: LearnEntry; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.entry) setEntry(body.entry);
    } catch (e) {
      setEntry({ ...entry });
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [entry, busy, replyId]);
  return { entry, error, busy, toggle };
}

/** 영수증 한 줄 + 학습 스위치. 기록이 없으면(예전 답) 그리지 않는다. */
export function ThreadsReceipt({ replyId, className }: { replyId: string; className?: string }) {
  const { entry, error, busy, toggle } = useLearnEntry(replyId);
  if (!entry) return null;
  return (
    <div className={cn("flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <p className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-neutral-600">
        <CheckIcon className={cn("size-3.5 shrink-0", entry.learn ? "text-emerald-700" : "text-neutral-400")} aria-hidden />
        <span className="truncate">{receiptText(entry)}</span>
      </p>
      <Switch
        label="학습에 쓰기"
        checked={entry.learn}
        onToggle={() => void toggle()}
        disabled={busy}
        size="compact"
        className="ml-auto text-[11.5px] [&_[role=switch][aria-checked=true]]:!bg-emerald-700"
      />
      {error ? <p className="w-full text-[11px] text-amber-800">{error}</p> : null}
    </div>
  );
}

/* ── 보낸 직후 영수증 띠 ─────────────────────────────── */

type Announce = { replyId: string; username: string; at: number } | null;
let current: Announce = null;
const listeners = new Set<() => void>();

/** 보냈거나 [달았어요]를 누른 직후 부른다 */
export function announceReceipt(replyId: string, username: string) {
  current = { replyId, username, at: Date.now() };
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const DOCK_MS = 12_000;
const noop = () => () => {};

export function ReceiptDock() {
  const reduce = useReducedMotion();
  const shown = useSyncExternalStore(subscribe, () => current, () => null);
  const [closedAt, setClosedAt] = useState(0);
  const hover = useRef(false);
  const open = shown && shown.at > closedAt ? shown : null;
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      if (!hover.current && Date.now() - open.at > DOCK_MS) setClosedAt(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, [open]);
  // 서버 그림과 첫 클라이언트 그림을 맞춘다 — 포털은 붙은 뒤에만
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] -translate-x-1/2">
      <AnimatePresence>
        {open ? (
          <motion.div
            key={open.at}
            role="status"
            initial={{ opacity: 0, y: reduce ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : 6, transition: spring.moderate.exit }}
            transition={spring.moderate}
            onPointerEnter={() => (hover.current = true)}
            onPointerLeave={() => (hover.current = false)}
            className="pointer-events-auto w-[400px] rounded-xl bg-white px-4 py-2.5 shadow-lg shadow-neutral-950/5 ring-1 ring-neutral-950/5"
          >
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-900">@{open.username} 님께 답을 달았어요</p>
              <button
                type="button"
                onClick={() => setClosedAt(Date.now())}
                aria-label="닫기"
                className={cn("inline-flex size-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700", press)}
              >
                <XMarkIcon className="size-4" />
              </button>
            </div>
            <ThreadsReceipt replyId={open.replyId} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>,
    document.body
  );
}
