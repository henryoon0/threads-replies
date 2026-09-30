"use client";

// 원문 형광 캡처: 원본 주소가 있는 근거(원글 원본·수집한 원문·웹·붙인 링크)는 미리 찍어 두고,
// 근거 연결선의 작은 캡처를 누르면 크게 연다 (Lightbox). henry 노트는 찍지 않는다.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowTopRightOnSquareIcon, XMarkIcon } from "@heroicons/react/16/solid";
import type { AnswerSource, EvidenceShot } from "@/lib/threads-replies/model";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { isShootableSource } from "./use-threads-answer";
import { press } from "./threads-answer-verdict";

export function Lightbox({ shot, onClose }: { shot: EvidenceShot | null; onClose: () => void }) {
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

/** 원본 주소가 있는 근거는 형광 캡처를 미리 찍어 둔다 (답글에 자동으로 붙는다) */
export function useAutoShots(replyId: string, sources: AnswerSource[], request: (replyId: string, source: AnswerSource) => void) {
  useEffect(() => {
    for (const s of sources) if (isShootableSource(s)) request(replyId, s);
  }, [replyId, sources, request]);
}
