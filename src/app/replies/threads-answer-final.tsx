"use client";

// 완성된 답 (시안 픽 10 henry 메모 + 픽 11·13). 패널 맨 아래, 보낼 답 전체를 한 곳에서 보고 고친다.
// 고치는 동안 관문이 바로 칠하고(호버하면 이유), 칠한 곳을 누르면 제안 표현으로 바꾼다.
// strict 계정은 막는 표현이 남아 있으면 [보내기]가 잠긴다. 따로 떨어진 다시 쓰기 도구는 두지 않는다 (픽 13 "빼줘").

import { useState, type DragEvent, type ReactNode } from "react";
import { ArrowUturnLeftIcon, ForwardIcon, PaperAirplaneIcon, SparklesIcon } from "@heroicons/react/16/solid";
import { BorderBeam } from "@/components/border-beam";
import type { GateResult } from "@/lib/threads-replies/model";
import { cn } from "@/lib/utils";
import { press } from "./threads-answer-verdict";
import { imageFileOf } from "./threads-answer-image";
import { applySuggest, GateEditor, gateLine, type GateMode } from "./threads-gate";

/** 카드에 이미지를 끌어 놓으면 답글 이미지로 붙인다 */
function useImageDrop(onImage: ((file: File) => void) | null) {
  const [over, setOver] = useState(false);
  if (!onImage) return { over: false, handlers: {} };
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        if (!over) setOver(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setOver(false);
        const file = imageFileOf(e.dataTransfer.files);
        if (file) onImage(file);
      },
    },
  };
}

const MAX_LEN = 500;

/** 칠하지 않는 막는 표현(링크 등)에 바꿀 말이 있으면 한 번에 바꾸는 작은 버튼 */
function NoteFix({ gate, draft, setDraft, locked, busy }: { gate: GateResult; draft: string; setDraft: (v: string) => void; locked: boolean; busy: boolean }) {
  const hit = gate.notes?.find((n) => n.suggest !== undefined);
  if (!hit || locked || busy) return null;
  return (
    <button type="button" onClick={() => setDraft(applySuggest(draft, hit))} className={cn("ml-1.5 font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800", press)}>
      “{hit.suggest}”(으)로 바꾸기
    </button>
  );
}

/** 예전 답과 비교하는 중 한 줄 (센 결과는 관문 한 줄이 이미 적는다). */
function PastLine({ past }: { past?: { hits: readonly unknown[]; checking: boolean } }) {
  return past?.checking ? <p className="-mt-1 px-3 pb-2 text-[11.5px] text-neutral-400">예전 답과 비교하는 중이에요</p> : null;
}

function FinalHead({ length, edited, onRevert }: { length: number; edited: boolean; onRevert: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-2">
      <h3 className="text-[12.5px] font-semibold text-neutral-900">완성된 답</h3>
      <span className={cn("text-[11px] tabular-nums", length > MAX_LEN ? "text-amber-700" : "text-neutral-400")}>
        {length}/{MAX_LEN}자
      </span>
      {edited ? (
        <button
          type="button"
          onClick={onRevert}
          className={cn("ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800", press)}
        >
          <ArrowUturnLeftIcon className="size-3" />
          초안으로 되돌리기
        </button>
      ) : null}
    </div>
  );
}

function FinalFooter({
  status,
  onMakeDraft,
  canSend,
  waiting,
  onSkip,
  onSend,
}: {
  status: ReactNode;
  onMakeDraft: (() => void) | null;
  canSend: boolean;
  waiting: boolean;
  onSkip: () => void;
  onSend: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2 pt-1 shadow-[0_-1px_0_0_rgba(10,10,10,0.05)]">
      {onMakeDraft ? (
        <button
          type="button"
          onClick={onMakeDraft}
          className={cn("inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50", press)}
        >
          <SparklesIcon className="size-3.5" />
          초안 만들기
        </button>
      ) : null}
      {status}
      <span className="ml-auto" />
      <button
        type="button"
        onClick={onSkip}
        disabled={waiting}
        className={cn("inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-xs text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700 disabled:opacity-40", press)}
      >
        <ForwardIcon className="size-3.5" />
        건너뛰기
      </button>
      <button
        type="button"
        onClick={onSend}
        disabled={!canSend || waiting}
        className={cn("inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-emerald-700 px-3.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-40", press)}
      >
        <PaperAirplaneIcon className="size-3.5" />
        {waiting ? "곧 보내요" : "보내기"}
        {waiting ? null : <span className="ml-0.5 text-[10px] font-normal text-white/70">⌘↵</span>}
      </button>
    </div>
  );
}

function statusOf(error: string | null, working: boolean): ReactNode {
  if (working) return <span className="px-1 text-[11px] text-neutral-500">초안을 쓰는 중이에요</span>;
  return error ? <span className="min-w-0 truncate px-1 text-[11px] text-amber-800">{error}</span> : null;
}

export function FinalAnswer({
  draft,
  setDraft,
  aiDraft,
  gate,
  gateMode,
  past,
  locked,
  busy,
  drafting,
  error,
  canSend,
  waiting,
  attachment,
  toolbar,
  onImage,
  onMakeDraft,
  onSkip,
  onSend,
}: {
  /** 답 버전 버튼 (09-29 henry: 완성된 답 칸 안에서 누른다) */
  toolbar?: ReactNode;
  draft: string;
  setDraft: (v: string) => void;
  /** 고른 벌의 AI 원문 — 고쳤으면 [되돌리기]로 돌아간다 */
  aiDraft: string | null;
  gate: GateResult;
  gateMode: GateMode;
  /** 예전 답과 다른 문장 (칠하기는 gate 에 이미 들어 있다) */
  past?: { hits: readonly unknown[]; checking: boolean };
  locked: boolean;
  busy: boolean;
  drafting: boolean;
  error: string | null;
  canSend: boolean;
  waiting: boolean;
  attachment: ReactNode;
  /** 끌어 놓은 이미지 (잠겨 있으면 null) */
  onImage: ((file: File) => void) | null;
  onMakeDraft: (() => void) | null;
  onSkip: () => void;
  onSend: () => void;
}) {
  const line = gateLine(gate, gateMode);
  const edited = aiDraft != null && !locked && draft.trim() !== aiDraft.trim();
  const drop = useImageDrop(onImage);
  const working = busy || drafting;
  return (
    <section
      aria-label="완성된 답"
      className={cn("relative rounded-[18px] bg-white p-1 shadow-card ring-1 transition-[box-shadow] duration-150", drop.over ? "ring-2 ring-emerald-500/60" : "ring-neutral-950/5")}
      {...drop.handlers}
    >
      <FinalHead length={draft.length} edited={edited} onRevert={() => setDraft(aiDraft ?? "")} />
      {toolbar}
      <div className={cn("transition-opacity duration-200", busy && "opacity-50")}>
        <GateEditor
          label="완성된 답"
          value={draft}
          onChange={setDraft}
          result={gate}
          readOnly={locked || busy}
          placeholder={drafting ? "초안이 곧 들어와요. 직접 써도 돼요" : "답글을 써 주세요"}
          onSubmit={onSend}
          className="min-h-[15rem] whitespace-pre-wrap break-keep px-3 pb-3 pt-2 text-[15px] leading-[1.75] text-neutral-800 [overflow-wrap:anywhere]"
        />
      </div>
      <p className={cn("px-3 pb-2 text-[11.5px]", line.tone)}>
        {line.text}
        <NoteFix gate={gate} draft={draft} setDraft={setDraft} locked={locked} busy={busy} />
      </p>
      <PastLine past={past} />
      {attachment}
      <FinalFooter
        status={statusOf(error, working)}
        onMakeDraft={onMakeDraft}
        canSend={canSend && draft.length <= MAX_LEN}
        waiting={waiting}
        onSkip={onSkip}
        onSend={onSend}
      />
      {working ? <BorderBeam radius={18} /> : null}
    </section>
  );
}
