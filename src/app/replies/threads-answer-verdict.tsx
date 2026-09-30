"use client";

// 답할 수 있음 판정 (픽: scenes-th-answer verdict). 초안 맨 위 판정 한 줄, 근거는 접힌 칩.
// 칩을 누르면 그 근거 카드(원문 그대로 인용 + 링크)가 칩 자리에서 펼쳐지고, 초안에서 그 근거를 쓴 문장이 칠해진다.

import { useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowTopRightOnSquareIcon, CheckCircleIcon, ExclamationTriangleIcon, QuestionMarkCircleIcon } from "@heroicons/react/16/solid";
import type { AnswerSource, AnswerVerdict, DraftSentence, ReplyAnswer, SourceKind } from "@/lib/threads-replies/model";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

export const press = "transition-[color,background-color,scale] duration-150 ease-[var(--motion-ease-out)] active:scale-[0.97]";

const KIND_TONE: Record<SourceKind, string> = {
  "원글 원본": "bg-emerald-50 text-emerald-700",
  "수집한 원문": "bg-emerald-50 text-emerald-700",
  "붙인 링크": "bg-emerald-50 text-emerald-700",
  "내 자료": "bg-sky-50 text-sky-700",
  웹: "bg-neutral-100 text-neutral-600",
  수집노트: "bg-sky-50 text-sky-700",
  FAQ: "bg-sky-50 text-sky-700",
  "강의 자료": "bg-amber-50 text-amber-700",
  "지난 글": "bg-neutral-100 text-neutral-600",
  "내 경험": "bg-rose-50 text-rose-700",
  "성분 페이지": "bg-sky-50 text-sky-700",
  "팟캐스트 발언": "bg-amber-50 text-amber-700",
};

export function SourceKindChip({ kind }: { kind: SourceKind }) {
  return <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", KIND_TONE[kind])}>{kind}</span>;
}

const VERDICT: Record<AnswerVerdict, { label: string; Icon: typeof CheckCircleIcon; tone: string; bg: string }> = {
  answerable: { label: "원본 자료로 답할 수 있어요", Icon: CheckCircleIcon, tone: "text-emerald-800", bg: "bg-emerald-50" },
  partial: { label: "일부만 자료로 답할 수 있어요", Icon: ExclamationTriangleIcon, tone: "text-amber-800", bg: "bg-amber-50" },
  unknown: { label: "자료에 없어요 · 모른다고 답해요", Icon: QuestionMarkCircleIcon, tone: "text-neutral-800", bg: "bg-neutral-100" },
};

export function unsupported(sentences: DraftSentence[]): number {
  return sentences.filter((s) => s.sourceIds.length === 0).length;
}

export function VerdictHead({ answer }: { answer: ReplyAnswer }) {
  const v = VERDICT[answer.verdict];
  const total = answer.sentences.length;
  const miss = unsupported(answer.sentences);
  return (
    <div className={cn("rounded-[12px] px-3 py-2.5", v.bg)}>
      <div className="flex items-center gap-2">
        <v.Icon className={cn("size-4 shrink-0", v.tone)} />
        <p className={cn("text-[13px] font-semibold", v.tone)}>{v.label}</p>
        {total > 0 ? (
          <p className="ml-auto shrink-0 text-[11px] tabular-nums text-neutral-500">
            문장 {total}개 중 {total - miss}개 근거 있음
          </p>
        ) : null}
      </div>
      {answer.verdictReason ? (
        <p className="mt-1 pl-6 text-[11.5px] leading-relaxed text-neutral-600 break-keep">{answer.verdictReason}</p>
      ) : null}
    </div>
  );
}

export function SourceCard({ s }: { s: AnswerSource }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-emerald-700/20">
      <p className="flex items-center gap-1.5">
        <SourceKindChip kind={s.kind} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-800">{s.title}</span>
      </p>
      <p className="mt-1.5 whitespace-pre-line break-keep text-[12px] leading-relaxed text-neutral-700">“{s.quote}”</p>
      {s.url ? (
        <a
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-flex max-w-full items-center gap-1 text-[11px] text-neutral-500 hover:text-emerald-700"
        >
          <span className="truncate">{s.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
          <ArrowTopRightOnSquareIcon className="size-3 shrink-0" />
        </a>
      ) : s.origin ? (
        <p className="mt-1.5 truncate text-[10.5px] text-neutral-400">{s.origin}</p>
      ) : null}
    </div>
  );
}

function Chip({ open, onClick, tone, children }: { open: boolean; onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void; tone: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-full px-2.5 text-[11px] ring-1",
        press,
        open ? "bg-white ring-neutral-950/15" : cn("ring-neutral-950/5 hover:bg-white", tone)
      )}
    >
      {children}
    </button>
  );
}

/** 접힌 근거 칩 + 누른 칩 자리에서 펼쳐지는 카드. open = 근거 id 또는 "miss"(확인 필요). */
export function SourceChips({
  answer,
  open,
  onOpen,
}: {
  answer: ReplyAnswer;
  open: string | null;
  onOpen: (key: string | null) => void;
}) {
  const reduce = useReducedMotion();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [origin, setOrigin] = useState(0);
  const miss = unsupported(answer.sentences);
  const openSrc = open && open !== "miss" ? answer.sources.find((s) => s.id === open) : undefined;

  const toggle = (key: string, e: ReactMouseEvent<HTMLButtonElement>) => {
    const box = boxRef.current?.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    if (box) setOrigin(r.left - box.left + r.width / 2);
    onOpen(open === key ? null : key);
  };

  if (answer.sources.length === 0 && miss === 0) return null;
  return (
    <div ref={boxRef} className="relative mt-2 flex flex-wrap items-center gap-1.5">
      {answer.sources.map((s) => (
        <Chip key={s.id} open={open === s.id} onClick={(e) => toggle(s.id, e)} tone="bg-neutral-950/[0.02]">
          <SourceKindChip kind={s.kind} />
          <span className="truncate text-neutral-600">{s.title}</span>
        </Chip>
      ))}
      {miss > 0 ? (
        <Chip open={open === "miss"} onClick={(e) => toggle("miss", e)} tone="bg-amber-50/60">
          <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
          <span className="font-medium text-amber-700">확인 필요 {miss}</span>
        </Chip>
      ) : null}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key={open}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: spring.moderate.exit }}
            transition={spring.moderate}
            style={{ transformOrigin: `${origin}px 0px` }}
            className="mt-1 w-full"
          >
            {openSrc ? (
              <SourceCard s={openSrc} />
            ) : (
              <p className="rounded-xl bg-amber-50 p-3 text-[11.5px] leading-relaxed text-amber-800 ring-1 ring-amber-700/20 break-keep">
                주황 점이 붙은 문장은 어느 자료에도 없어요. 내 경험인지 확인하세요.
              </p>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function MissDot() {
  return (
    <span className="ml-1 inline-flex items-center gap-1 whitespace-nowrap align-[1px] text-[10px] font-medium text-amber-700">
      <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
      확인 필요
    </span>
  );
}

/** 문장 단위 초안 보기. 열린 칩의 근거를 쓴 문장은 emerald, "확인 필요" 칩이면 근거 없는 문장을 amber 로 칠한다. */
export function SentenceText({ sentences, open, className }: { sentences: DraftSentence[]; open: string | null; className?: string }) {
  return (
    <p className={className}>
      {sentences.map((s, i) => {
        const miss = s.sourceIds.length === 0;
        const lit = open != null && (open === "miss" ? miss : s.sourceIds.includes(open));
        return (
          <span key={i}>
            <span
              className={cn(
                "rounded box-decoration-clone transition-colors duration-150",
                lit && (open === "miss" ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900")
              )}
            >
              {s.text}
            </span>
            {miss ? <MissDot /> : null}{" "}
          </span>
        );
      })}
    </p>
  );
}
