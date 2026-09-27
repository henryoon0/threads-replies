"use client";

// 보내기 전 근거 보기 (픽: scenes-th-send). 원본 주소가 있는 근거(원글 원본·수집한 원문·웹·붙인 링크)는
// 원문 화면에 인용을 형광펜으로 칠한 캡처를 작게 보여주고, 누르면 크게 연다.
// henry 노트(수집노트·강의 자료·FAQ·지난 글·내 경험)는 찍지 않고 인용 글만 보여준다.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, XMarkIcon } from "@heroicons/react/16/solid";
import type { AnswerSource, EvidenceShot } from "@/lib/threads-replies/model";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { isShootableSource, shotKey, type ShotState } from "./use-threads-answer";
import { SourceKindChip, press } from "./threads-answer-verdict";

function ShotTile({ s, state, onOpen, onRetry }: { s: AnswerSource; state: ShotState | undefined; onOpen: (shot: EvidenceShot) => void; onRetry: () => void }) {
  const reduce = useReducedMotion();
  if (state?.status === "done") {
    return (
      <motion.button
        type="button"
        layoutId={reduce ? undefined : `th-shot-${state.shot.image}`}
        onClick={() => onOpen(state.shot)}
        className={cn("group block w-full overflow-hidden rounded-[10px] bg-neutral-50 ring-1 ring-neutral-950/5", press)}
        aria-label={`${s.title} 원문 캡처 크게 보기`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- public/ 아래 방금 찍은 PNG, 최적화 대상 아님 */}
        <img src={state.shot.image} alt="" className="h-32 w-full object-cover object-top" />
      </motion.button>
    );
  }
  if (state?.status === "failed") {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-1.5 rounded-[10px] bg-neutral-50 px-3 text-center ring-1 ring-neutral-950/5">
        <p className="line-clamp-2 text-[11px] text-neutral-500 break-keep">{state.error}</p>
        <button type="button" onClick={onRetry} className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50", press)}>
          <ArrowPathIcon className="size-3" />
          다시 찍기
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-32 flex-col justify-end gap-1.5 overflow-hidden rounded-[10px] bg-neutral-100 p-3" aria-busy="true">
      <span className="h-2 w-3/4 animate-pulse rounded bg-neutral-200" />
      <span className="h-2 w-1/2 animate-pulse rounded bg-neutral-200" />
      <p className="text-[10.5px] text-neutral-500">원문을 찍는 중 · 10~25초</p>
    </div>
  );
}

function Lightbox({ shot, onClose }: { shot: EvidenceShot | null; onClose: () => void }) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!shot) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shot, onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {shot ? (
        <motion.div
          key="lightbox"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: spring.moderate.exit }}
          transition={spring.moderate}
          onClick={onClose}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-950/60 p-8"
          role="dialog"
          aria-label="원문 캡처"
        >
          <motion.div
            layoutId={reduce ? undefined : `th-shot-${shot.image}`}
            transition={spring.slow}
            className="relative max-h-full max-w-3xl overflow-auto rounded-xl bg-white shadow-lg ring-1 ring-neutral-950/5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 원본 크기 그대로 본다 */}
            <img src={shot.image} alt="원문에서 인용을 형광펜으로 칠한 캡처" className="block w-full" />
            <div className="sticky bottom-0 flex items-center gap-2 bg-white/95 px-3 py-2 shadow-[0_-1px_0_0_rgba(10,10,10,0.05)]">
              <a href={shot.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-[11.5px] text-neutral-600 hover:text-emerald-700">
                <span className="truncate">{shot.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                <ArrowTopRightOnSquareIcon className="size-3 shrink-0" />
              </a>
              <button type="button" onClick={onClose} className={cn("ml-auto inline-flex size-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100", press)} aria-label="닫기">
                <XMarkIcon className="size-4" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

export function EvidenceStrip({
  replyId,
  sources,
  shots,
  request,
}: {
  replyId: string;
  sources: AnswerSource[];
  shots: Record<string, ShotState>;
  request: (replyId: string, source: AnswerSource) => void;
}) {
  const [big, setBig] = useState<EvidenceShot | null>(null);
  const shootable = sources.filter(isShootableSource);
  const notes = sources.filter((s) => !isShootableSource(s));

  useEffect(() => {
    for (const s of shootable) request(replyId, s);
    // shootable 은 sources 에서 파생 — sources 가 바뀔 때만 다시 건다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyId, sources, request]);

  if (sources.length === 0) return null;
  return (
    <section className="mt-3">
      <p className="px-1 pb-1.5 text-[11px] font-medium text-neutral-500">보내기 전에 근거 확인</p>
      {shootable.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {shootable.map((s) => (
            <figure key={s.id} className="min-w-0">
              <ShotTile s={s} state={shots[shotKey(replyId, s)]} onOpen={setBig} onRetry={() => request(replyId, s)} />
              <figcaption className="mt-1 flex items-center gap-1.5 px-0.5">
                <SourceKindChip kind={s.kind} />
                <span className="truncate text-[11px] text-neutral-600">{s.title}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      {notes.length > 0 ? (
        <ul className={cn("flex flex-col gap-1.5", shootable.length > 0 && "mt-2")}>
          {notes.map((s) => (
            <li key={s.id} className="rounded-xl bg-white px-3 py-2 ring-1 ring-neutral-950/5">
              <p className="flex items-center gap-1.5">
                <SourceKindChip kind={s.kind} />
                <span className="min-w-0 truncate text-[11.5px] font-medium text-neutral-700">{s.title}</span>
              </p>
              <p className="mt-1 line-clamp-3 whitespace-pre-line text-[11.5px] leading-relaxed text-neutral-600 break-keep">“{s.quote}”</p>
            </li>
          ))}
        </ul>
      ) : null}
      <Lightbox shot={big} onClose={() => setBig(null)} />
    </section>
  );
}
