"use client";

// 지금 칸에 보이는 남은 댓글을 한 번에 건너뛴다. 로컬 원장에 표시만 하므로 스레드에는 아무것도 안 간다.
// 한 번 더 묻고, 건너뛴 뒤에는 되돌리기를 띄운다 (그 목록만 되살린다). 10-02 픽부터 ··· 메뉴에서 연다.

import { useState } from "react";
import { ArrowUturnLeftIcon } from "@heroicons/react/16/solid";

async function call(method: "POST" | "DELETE", ids: string[]): Promise<{ ids?: string[] }> {
  const res = await fetch("/api/threads-replies/skip-all", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`skip-all ${res.status}`);
  return (await res.json()) as { ids?: string[] };
}

const btn =
  "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium transition-[color,background-color,scale] duration-150 active:scale-[0.97] disabled:opacity-60";

function ConfirmRow({ count, onCancel, onConfirm }: { count: number; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-[11.5px] text-neutral-700 ring-1 ring-neutral-950/5">
      <span className="min-w-0 flex-1">남은 {count}건을 모두 건너뛸까요? 스레드에는 아무것도 안 가요.</span>
      <button type="button" onClick={onCancel} className={`${btn} text-neutral-500 hover:bg-neutral-950/[0.04]`}>
        취소
      </button>
      <button type="button" onClick={onConfirm} className={`${btn} bg-emerald-700 text-white hover:bg-emerald-800`}>
        모두 건너뛰기
      </button>
    </div>
  );
}

function UndoRow({ count, busy, onUndo, onClose }: { count: number; busy: boolean; onUndo: () => void; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-[11.5px] text-neutral-600 ring-1 ring-neutral-950/5">
      <span className="min-w-0 flex-1">{count}건 건너뛰었어요</span>
      <button type="button" onClick={onUndo} disabled={busy} className={`${btn} text-emerald-700 hover:bg-emerald-50`}>
        <ArrowUturnLeftIcon className="size-3.5" />
        되돌리기
      </button>
      <button type="button" onClick={onClose} className={`${btn} text-neutral-500 hover:bg-neutral-950/[0.04]`}>
        닫기
      </button>
    </div>
  );
}

/**
 * ··· 메뉴의 [남은 댓글 모두 건너뛰기]가 armed 를 켜면 목록 위에 확인 줄을 띄운다 (10-02 픽).
 * 평소엔 아무것도 그리지 않는다. 건너뛴 뒤엔 되돌리기 줄.
 */
export function ThreadsSkipAll({ ids, onChanged, armed, onClose }: { ids: string[]; onChanged: () => void; armed: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  const run = async (method: "POST" | "DELETE", target: string[]) => {
    setBusy(true);
    setError("");
    try {
      const out = await call(method, target);
      setUndo(method === "POST" ? (out.ids ?? []) : null);
      onClose();
      onChanged();
    } catch {
      setError(method === "POST" ? "건너뛰지 못했어요" : "되돌리지 못했어요");
    } finally {
      setBusy(false);
    }
  };

  if (undo?.length) return <UndoRow count={undo.length} busy={busy} onUndo={() => void run("DELETE", undo)} onClose={() => setUndo(null)} />;
  if (armed && ids.length && !busy) return <ConfirmRow count={ids.length} onCancel={onClose} onConfirm={() => void run("POST", ids)} />;
  return error ? <p className="text-[11px] text-rose-700">{error}</p> : null;
}
