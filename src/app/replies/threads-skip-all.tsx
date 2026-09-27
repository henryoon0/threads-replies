"use client";

// 지금 칸에 보이는 남은 댓글을 한 번에 건너뛴다. 로컬 원장에 표시만 하므로 스레드에는 아무것도 안 간다.
// 한 번 더 묻고, 건너뛴 뒤에는 되돌리기를 띄운다 (그 목록만 되살린다).

import { useState } from "react";
import { ArrowUturnLeftIcon, ForwardIcon } from "@heroicons/react/16/solid";

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

export function ThreadsSkipAll({ ids, onChanged }: { ids: string[]; onChanged: () => void }) {
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [undo, setUndo] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  const run = async (method: "POST" | "DELETE", target: string[]) => {
    setStep("busy");
    setError("");
    try {
      const out = await call(method, target);
      setUndo(method === "POST" ? (out.ids ?? []) : null);
      onChanged();
    } catch {
      setError(method === "POST" ? "건너뛰지 못했어요" : "되돌리지 못했어요");
    } finally {
      setStep("idle");
    }
  };

  if (undo?.length) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-[11.5px] text-neutral-600 ring-1 ring-neutral-950/5">
        <span className="min-w-0 flex-1">{undo.length}건 건너뛰었어요</span>
        <button type="button" onClick={() => void run("DELETE", undo)} disabled={step === "busy"} className={`${btn} text-emerald-700 hover:bg-emerald-50`}>
          <ArrowUturnLeftIcon className="size-3.5" />
          되돌리기
        </button>
        <button type="button" onClick={() => setUndo(null)} className={`${btn} text-neutral-500 hover:bg-neutral-950/[0.04]`}>
          닫기
        </button>
      </div>
    );
  }
  if (!ids.length) return null;
  if (step === "confirm") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-[11.5px] text-neutral-700 ring-1 ring-neutral-950/5">
        <span className="min-w-0 flex-1">남은 {ids.length}건을 모두 건너뛸까요? 스레드에는 아무것도 안 가요.</span>
        <button type="button" onClick={() => setStep("idle")} className={`${btn} text-neutral-500 hover:bg-neutral-950/[0.04]`}>
          취소
        </button>
        <button type="button" onClick={() => void run("POST", ids)} className={`${btn} bg-emerald-700 text-white hover:bg-emerald-800`}>
          모두 건너뛰기
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-[11px]">
      {error ? <span className="text-rose-700">{error}</span> : null}
      <button
        type="button"
        onClick={() => setStep("confirm")}
        disabled={step === "busy"}
        className={`${btn} ml-auto text-neutral-600 hover:bg-neutral-950/[0.04] hover:text-neutral-900`}
      >
        <ForwardIcon className="size-3.5" />
        남은 {ids.length}건 모두 건너뛰기
      </button>
    </div>
  );
}
