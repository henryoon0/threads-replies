"use client";

// 답 초안 칸. 픽 두 개가 만난다:
//  · 답할 수 있음 판정 (scenes-th-answer verdict) — 판정 한 줄 · 근거 칩 · 칠해지는 문장 · 확인 필요 점
//  · 링크 끌어 놓기 (scenes-th-sources drop-link) — 주소를 붙이거나 끌어 놓으면 근거로 붙여 다시 쓴다
// 초안은 고칠 수 있다. 처음 초안 그대로일 때만 문장별 칠하기를 보여주고, 누르면 입력칸으로 바뀐다.

import { useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChatBubbleLeftEllipsisIcon, GlobeAltIcon, LinkIcon, PlusIcon, SparklesIcon } from "@heroicons/react/16/solid";
import { BorderBeam } from "@/components/border-beam";
import type { ReplyAnswer } from "@/lib/threads-replies/model";
import { spring } from "@/lib/springs";
import { imageFileOf } from "./threads-answer-image";
import { cn } from "@/lib/utils";
import type { RegenerateInput } from "./use-threads-answer";
import { SentenceText, SourceChips, VerdictHead, press } from "./threads-answer-verdict";

const draftType = "px-4 pb-2 pt-3 text-[15px] leading-[1.7] text-neutral-800 break-keep";

/** 붙여 넣은 글 전체가 주소 하나면 그 주소. 글 속에 섞인 주소는 답글 본문으로 둔다. */
export function soleUrl(raw: string): string | null {
  const text = raw.trim();
  return /^https?:\/\/\S+$/i.test(text) ? text : null;
}

function isComposing(e: KeyboardEvent) {
  return e.nativeEvent.isComposing;
}

function statusText(busy: boolean, drafting: boolean, idle: ReactNode): ReactNode {
  if (busy) return "근거를 다시 모아 초안을 쓰는 중";
  if (drafting) return "초안을 쓰는 중이에요";
  return idle;
}

function PulseDot({ on }: { on: boolean }) {
  const reduce = useReducedMotion();
  const pulse = on && !reduce;
  return (
    <motion.span
      className={cn("size-1.5 shrink-0 rounded-full", on ? "bg-emerald-500" : "bg-neutral-300")}
      animate={pulse ? { opacity: [1, 0.3, 1] } : { opacity: 1 }}
      transition={pulse ? { duration: 0.9, repeat: Infinity } : spring.fast}
    />
  );
}

function StatusLine({ busy, drafting, error, idle }: { busy: boolean; drafting: boolean; error: string | null; idle: ReactNode }) {
  const on = busy || drafting;
  if (!on && !error && !idle) return null;
  if (error && !on) return <span className="min-w-0 truncate px-1 text-[11px] text-rose-600">{error}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 px-1 text-[11px] text-neutral-500">
      <PulseDot on={on} />
      <span className="truncate">{statusText(busy, drafting, idle)}</span>
    </span>
  );
}

function LinkInput({ disabled, onLink, onWeb }: { disabled: boolean; onLink: (url: string) => void; onWeb: () => void }) {
  const [value, setValue] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const accept = (raw: string) => {
    const url = soleUrl(raw);
    if (!url) {
      setHint("http 로 시작하는 주소 하나만 붙여 주세요");
      return;
    }
    setHint(null);
    setValue("");
    onLink(url);
  };
  return (
    <div className="px-1 pt-2">
      <div className="flex items-center gap-1.5">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[10px] bg-neutral-950/[0.03] px-2.5 focus-within:bg-white focus-within:ring-1 focus-within:ring-emerald-700/40">
          <LinkIcon className="size-3.5 shrink-0 text-neutral-400" />
          <input
            value={value}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isComposing(e)) {
                e.preventDefault();
                accept(value);
              }
            }}
            placeholder="근거로 붙일 주소 · 붙여 넣거나 초안 칸에 끌어 놓기"
            aria-label="근거로 붙일 주소"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-neutral-800 placeholder:text-neutral-400 focus:outline-none disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={onWeb}
          disabled={disabled}
          className={cn("inline-flex h-9 shrink-0 items-center gap-1 rounded-[10px] px-2.5 text-[11.5px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40", press)}
        >
          <GlobeAltIcon className="size-3.5" />
          웹에서 찾기
        </button>
      </div>
      {hint ? <p className="px-1 pt-1 text-[10.5px] text-amber-700">{hint}</p> : null}
    </div>
  );
}

function MyAsk({ ask, disabled, onAnswer }: { ask: string; disabled: boolean; onAnswer: (note: string) => void }) {
  const [value, setValue] = useState("");
  const submit = () => {
    if (!value.trim()) return;
    onAnswer(value.trim());
    setValue("");
  };
  return (
    <div className="mx-2 mb-1 rounded-[12px] bg-rose-50/60 px-3 py-2">
      <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-rose-800 break-keep">
        <ChatBubbleLeftEllipsisIcon className="mt-0.5 size-3.5 shrink-0" />
        {ask}
      </p>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !isComposing(e)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="한 줄로 답하면 그 경험을 넣어 다시 써요 (Enter)"
        aria-label="내 경험 한 줄"
        className="mt-1.5 h-8 w-full rounded-[8px] bg-white px-2.5 text-[12px] text-neutral-800 ring-1 ring-neutral-950/5 placeholder:text-neutral-400 focus:outline-none focus:ring-emerald-700/40 disabled:opacity-50"
      />
    </div>
  );
}

function DropOverlay({ on }: { on: boolean }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {on ? (
        <motion.div
          key="over"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: spring.fast.exit }}
          transition={spring.fast}
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[18px] bg-emerald-50/90 ring-2 ring-emerald-500/60"
        >
          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-800">
            <PlusIcon className="size-4" />
            여기에 놓으면 근거로 붙여 다시 써요
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** 놓인 것이 이미지 파일이면 답글에 붙이고, 주소면 근거로 붙인다. */
function handleDrop(data: DataTransfer, onLink: ((url: string) => void) | null, onImage?: (file: File) => void) {
  const file = onImage ? imageFileOf(data.files) : null;
  if (file && onImage) return onImage(file);
  const url = onLink ? soleUrl(data.getData("text/uri-list").split("\n")[0] || data.getData("text/plain")) : null;
  if (url && onLink) onLink(url);
}

/** 끌어 놓기: 칸 위에 주소를 놓으면 근거로, 이미지를 놓으면 답글 이미지로 붙인다. */
function useDropLink(enabled: boolean, onLink: ((url: string) => void) | null, onImage?: (file: File) => void) {
  const [over, setOver] = useState(false);
  if (!enabled) return { over: false, handlers: {} };
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!over) setOver(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setOver(false);
        handleDrop(e.dataTransfer, onLink, onImage);
      },
    },
  };
}

function DraftBody({
  answer,
  draft,
  setDraft,
  open,
  busy,
  placeholder,
  onLink,
  onSubmit,
}: {
  answer: ReplyAnswer | undefined;
  draft: string;
  setDraft: (v: string) => void;
  open: string | null;
  busy: boolean;
  placeholder: string;
  onLink: ((url: string) => void) | null;
  onSubmit: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const pristine = Boolean(answer && answer.sentences.length > 0 && draft.trim() === answer.draft.trim());
  const onPaste = (e: ClipboardEvent) => {
    const url = onLink ? soleUrl(e.clipboardData.getData("text/plain")) : null;
    if (!url || !onLink) return;
    e.preventDefault();
    onLink(url);
  };
  if (pristine && answer && !editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} disabled={busy} className="block w-full cursor-text text-left" aria-label="초안 고치기">
        <SentenceText sentences={answer.sentences} open={open} className={draftType} />
      </button>
    );
  }
  return (
    <textarea
      value={draft}
      autoFocus={editing}
      readOnly={busy}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => setEditing(false)}
      onPaste={onPaste}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isComposing(e)) {
          e.preventDefault();
          onSubmit();
        }
      }}
      rows={4}
      placeholder={placeholder}
      className={cn("field-sizing-content min-h-24 w-full resize-none rounded-[14px] bg-white focus:outline-none", draftType)}
    />
  );
}

function MakeDraft({ error, onClick }: { error: string | null; onClick: () => void }) {
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={cn("inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50", press)}
      >
        <SparklesIcon className="size-3.5" />
        초안 만들기
      </button>
      {error ? <span className="min-w-0 truncate text-[11px] text-rose-600">{error}</span> : null}
    </>
  );
}

export interface DraftCardProps {
  answer: ReplyAnswer | undefined;
  isQuestion: boolean;
  /** 보내기 대기 중 — 보낼 글이 이미 정해져 고칠 수 없다 */
  locked?: boolean;
  draft: string;
  setDraft: (v: string) => void;
  /** 다시 쓰는 중 (이 패널이 부른 것) */
  busy: boolean;
  /** 백그라운드 잡이 첫 초안을 쓰는 중 */
  drafting: boolean;
  error: string | null;
  regenerate: (input?: RegenerateInput) => void;
  onSubmit: () => void;
  actions: ReactNode;
  /** 초안 아래 붙임 줄(이미지). 없으면 안 그린다 */
  attachment?: ReactNode;
  /** 끌어 놓기로 들어온 이미지 (붙여넣기는 useReplyImage 가 창 단위로 받는다) */
  onImage?: (file: File) => void;
}

/** 판정 한 줄 + 근거 칩 + 주소 붙이기. 질문일 때만. henry 가 손으로 쓴 답이면 판정은 없다. */
function CardTop({ p, open, setOpen, frozen }: { p: DraftCardProps; open: string | null; setOpen: (v: string | null) => void; frozen: boolean }) {
  if (!p.isQuestion) return null;
  const answer = p.answer && p.answer.model !== "henry" ? p.answer : undefined;
  return (
    <>
      {answer ? (
        <div className="px-1 pt-1">
          <VerdictHead answer={answer} />
          <SourceChips answer={answer} open={open} onOpen={setOpen} />
        </div>
      ) : null}
      <LinkInput disabled={frozen} onLink={(url) => p.regenerate({ extraLinks: [url] })} onWeb={() => p.regenerate({ allowWeb: true })} />
    </>
  );
}

function CardFooter({ p }: { p: DraftCardProps }) {
  const idle = !p.answer && !p.drafting && !p.busy;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
      {idle ? (
        <MakeDraft error={p.error} onClick={() => p.regenerate()} />
      ) : (
        <StatusLine busy={p.busy} drafting={p.drafting} error={p.error} idle={p.isQuestion ? "주소를 놓으면 근거로 붙여 다시 써요" : ""} />
      )}
      <span className="ml-auto" />
      {p.actions}
    </div>
  );
}

function placeholderFor(drafting: boolean) {
  return drafting ? "초안이 곧 들어와요. 직접 써도 돼요" : "답글을 써 주세요";
}

function Beam({ on }: { on: boolean }) {
  return on ? <BorderBeam radius={18} /> : null;
}

/** 카드 끌어 놓기: 질문이면 주소를, 이미지 받기가 켜졌으면 이미지를 받는다 */
function useCardDrop(p: DraftCardProps, frozen: boolean, link: (url: string) => void) {
  const enabled = (p.isQuestion || Boolean(p.onImage)) && !frozen;
  return useDropLink(enabled, p.isQuestion ? link : null, p.onImage);
}

/**
 * 초안 확인 칸: 근거가 없어 뺀 문장 · 예전 답과 어긋나는 문장.
 * 어긋남은 그 결과를 잰 글이 지금 글과 같을 때만 보인다 (고치면 옛 결과라 숨긴다).
 */
export function DraftChecks({ answer, draft }: { answer?: ReplyAnswer; draft: string }) {
  const dropped = answer?.dropped ?? [];
  const conflicts = answer && answer.consistencyFor === draft ? answer.consistency ?? [] : [];
  if (!dropped.length && !conflicts.length) return null;
  return (
    <div className="space-y-1.5 px-3 pb-2 text-[11.5px] leading-relaxed text-neutral-600 break-keep">
      {conflicts.map((c) => (
        <p key={`c-${c.sentenceStart}`}>
          <span className="font-medium text-neutral-800">예전 답과 다름:</span> &ldquo;{draft.slice(c.sentenceStart, c.sentenceEnd)}&rdquo;
          {" · "}
          {c.note} (예전엔 &ldquo;{c.past.text}&rdquo;{c.past.date ? `, ${c.past.date}` : ""})
        </p>
      ))}
      {dropped.map((d) => (
        <p key={`d-${d.text}`}>
          <span className="font-medium text-neutral-800">근거 없어 뺀 문장:</span> &ldquo;{d.text}&rdquo; · {d.reason}
        </p>
      ))}
    </div>
  );
}

export function ThreadsDraftCard(p: DraftCardProps) {
  const { answer, isQuestion, busy, drafting, regenerate } = p;
  const [open, setOpen] = useState<string | null>(null);
  const frozen = busy || Boolean(p.locked);
  const link = (url: string) => regenerate({ extraLinks: [url] });
  const drop = useCardDrop(p, frozen, link);
  const ask = isQuestion ? answer?.myAsk : undefined;

  return (
    <div className="relative rounded-[18px] bg-white p-1 shadow-card ring-1 ring-neutral-950/5" {...drop.handlers}>
      <CardTop p={p} open={open} setOpen={setOpen} frozen={frozen} />
      <div className={cn("transition-opacity duration-200", busy && "opacity-50")}>
        <DraftBody
          answer={isQuestion ? answer : undefined}
          draft={p.draft}
          setDraft={p.setDraft}
          open={open}
          busy={frozen}
          placeholder={placeholderFor(drafting)}
          onLink={isQuestion ? link : null}
          onSubmit={p.onSubmit}
        />
      </div>
      <DraftChecks answer={answer} draft={p.draft} />
      {p.attachment}
      {ask ? <MyAsk ask={ask} disabled={frozen} onAnswer={(note) => regenerate({ myNote: note })} /> : null}
      <CardFooter p={p} />
      <DropOverlay on={drop.over} />
      <Beam on={busy || drafting} />
    </div>
  );
}
