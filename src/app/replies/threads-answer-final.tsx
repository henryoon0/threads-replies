"use client";

// 완성된 답 (시안 픽 10 henry 메모 + 픽 11·13). 패널 맨 아래, 보낼 답 전체를 한 곳에서 보고 고친다.
// 10-02 픽 "편집칸이 곧 스레드": 상대 댓글 → 대화선 → 내 아바타·핸들 자리에서 바로 고친다. 따로 미리보기가 없다.
// 고치는 동안 관문이 바로 칠하고(호버하면 이유), 칠한 곳을 누르면 제안 표현으로 바꾼다.
// strict 계정은 막는 표현이 남아 있으면 [보내기]가 잠긴다. 따로 떨어진 다시 쓰기 도구는 두지 않는다 (픽 13 "빼줘").

import { useState, type DragEvent, type ReactNode } from "react";
import {
  ArrowUturnLeftIcon,
  ForwardIcon,
  PaperAirplaneIcon,
  SparklesIcon,
} from "@heroicons/react/16/solid";
import { BorderBeam } from "@/components/border-beam";
import type { GateResult } from "@/lib/threads-replies/model";
import { cn } from "@/lib/utils";
import { press } from "./threads-answer-verdict";
import { imageFileOf } from "./threads-answer-image";
import { applySuggest, GateEditor, gateLine } from "./threads-gate";

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
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOver(false);
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
function NoteFix({
  gate,
  draft,
  setDraft,
  locked,
  busy,
}: {
  gate: GateResult;
  draft: string;
  setDraft: (v: string) => void;
  locked: boolean;
  busy: boolean;
}) {
  const hit = gate.notes?.find((n) => n.suggest !== undefined);
  if (!hit || locked || busy) return null;
  return (
    <button
      type="button"
      onClick={() => setDraft(applySuggest(draft, hit))}
      className={cn(
        "ml-1.5 font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800",
        press,
      )}
    >
      “{hit.suggest}”(으)로 바꾸기
    </button>
  );
}

/** 예전 답과 비교하는 중 한 줄 (센 결과는 관문 한 줄이 이미 적는다). */
function PastLine({
  past,
}: {
  past?: { hits: readonly unknown[]; checking: boolean };
}) {
  return past?.checking ? (
    <p className="-mt-1 px-3 pb-2 text-[11.5px] text-neutral-400">
      예전 답과 비교하는 중이에요
    </p>
  ) : null;
}

/** 글자 수는 450자를 넘을 때만 (10-02 픽 — 평소엔 할 일이 없는 숫자) */
const COUNT_FROM = 450;

/** 내 답글 줄 머리: @핸들 · (넘칠 때) 글자 수 · (고쳤을 때) 되돌리기. 되돌리기 높이(h-7)는 늘 잡아 둔다 */
function MineHead({
  handle,
  length,
  edited,
  onRevert,
}: {
  handle: string;
  length: number;
  edited: boolean;
  onRevert: () => void;
}) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      <span className="text-[14px] font-semibold text-neutral-950">
        {handle}
      </span>
      {length > COUNT_FROM ? (
        <span
          className={cn(
            "text-[11px] tabular-nums",
            length > MAX_LEN ? "text-amber-700" : "text-neutral-400",
          )}
        >
          {length}/{MAX_LEN}자
        </span>
      ) : null}
      {edited ? (
        <button
          type="button"
          onClick={onRevert}
          className={cn(
            "ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800",
            press,
          )}
        >
          <ArrowUturnLeftIcon className="size-3" />
          초안으로 되돌리기
        </button>
      ) : null}
    </div>
  );
}

export interface ThreadSide {
  /** 상대 댓글 (@이름 · 시간 · 본문) */
  them: { username: string; when: string; text: string };
  me: { handle: string; mark: string };
}

function Avatar({ mark, me }: { mark: string; me?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-medium",
        me ? "bg-emerald-700 text-white" : "bg-neutral-200 text-neutral-600",
      )}
    >
      {mark}
    </span>
  );
}

/** 상대 댓글 한 줄 + 아바타 아래로 이어지는 대화선 — 스레드 앱에서 답글이 달리는 모양 그대로 */
function TheirRow({ them }: { them: ThreadSide["them"] }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <Avatar mark={them.username.slice(0, 1).toUpperCase()} />
        <span
          aria-hidden
          className="mt-1.5 w-0.5 flex-1 rounded-full bg-neutral-200"
        />
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <p className="flex items-center gap-1.5 text-[14px]">
          <span className="font-semibold text-neutral-950">
            {them.username}
          </span>
          <span className="text-neutral-400">{them.when}</span>
        </p>
        <p className="mt-0.5 whitespace-pre-wrap break-keep text-[15px] leading-[1.45] text-neutral-950">
          {them.text}
        </p>
      </div>
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
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50",
            press,
          )}
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
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-xs text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700 disabled:opacity-40",
          press,
        )}
      >
        <ForwardIcon className="size-3.5" />
        건너뛰기
      </button>
      <button
        type="button"
        onClick={onSend}
        disabled={!canSend || waiting}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-emerald-700 px-3.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-40",
          press,
        )}
      >
        <PaperAirplaneIcon className="size-3.5" />
        {waiting ? "곧 보내요" : "보내기"}
        {waiting ? null : (
          <span className="ml-0.5 text-[10px] font-normal text-white/70">
            ⌘↵
          </span>
        )}
      </button>
    </div>
  );
}

function statusOf(error: string | null, working: boolean): ReactNode {
  if (working)
    return (
      <span className="px-1 text-[11px] text-neutral-500">
        초안을 쓰는 중이에요
      </span>
    );
  return error ? (
    <span className="min-w-0 truncate px-1 text-[11px] text-amber-800">
      {error}
    </span>
  ) : null;
}

export function FinalAnswer({
  draft,
  setDraft,
  aiDraft,
  gate,
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
  thread,
}: {
  /** 스레드 모양(10-02 픽): 상대 댓글 → 내 답글 자리의 편집칸. 쓰는 그대로가 달릴 모습이다 */
  thread: ThreadSide;
  /** 답 버전 버튼 (09-29 henry: 완성된 답 칸 안에서 누른다) */
  toolbar?: ReactNode;
  draft: string;
  setDraft: (v: string) => void;
  /** 고른 벌의 AI 원문 — 고쳤으면 [되돌리기]로 돌아간다 */
  aiDraft: string | null;
  gate: GateResult;
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
  const line = gateLine(gate);
  const edited = aiDraft != null && !locked && draft.trim() !== aiDraft.trim();
  const drop = useImageDrop(onImage);
  const working = busy || drafting;
  return (
    <section
      aria-label="완성된 답"
      className={cn(
        "relative rounded-[18px] bg-white p-1 shadow-card ring-1 transition-[box-shadow] duration-150",
        drop.over ? "ring-2 ring-emerald-500/60" : "ring-neutral-950/5",
      )}
      {...drop.handlers}
    >
      <div className="px-3 pt-3">
        <TheirRow them={thread.them} />
        <div className="flex gap-3">
          <Avatar mark={thread.me.mark} me />
          <div
            className={cn(
              "min-w-0 flex-1 transition-opacity duration-200",
              busy && "opacity-50",
            )}
          >
            <MineHead
              handle={thread.me.handle}
              length={draft.length}
              edited={edited}
              onRevert={() => setDraft(aiDraft ?? "")}
            />
            {/* 편집칸이 곧 미리보기 — whitespace-pre-wrap 이라 엔터·연속 띄어쓰기가 달릴 글(postedText)과 같다 */}
            <GateEditor
              label="완성된 답"
              value={draft}
              onChange={setDraft}
              result={gate}
              readOnly={locked || busy}
              placeholder={
                drafting
                  ? "초안이 곧 들어와요. 직접 써도 돼요"
                  : "답글을 써 주세요"
              }
              onSubmit={onSend}
              className="min-h-[9rem] whitespace-pre-wrap break-keep pb-3 pt-0.5 text-[15px] leading-[1.45] text-neutral-950 [overflow-wrap:anywhere]"
            />
          </div>
        </div>
      </div>
      <p className={cn("px-3 pb-2 text-[11.5px]", line.tone)}>
        {line.text}
        <NoteFix
          gate={gate}
          draft={draft}
          setDraft={setDraft}
          locked={locked}
          busy={busy}
        />
      </p>
      <PastLine past={past} />
      {toolbar}
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
