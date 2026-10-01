"use client";

// 보내기 (픽: scenes-th-send one-undo). [보내기] → 서버 대기열 + 5초 되돌리기 띠 → 시간이 다 되면 서버가 보낸다(화면을 떠나도).
// 권한이 없으면 (threads_manage_replies) [복사하고 스레드에서 열기] + [달았어요] 폴백.
// 콘텐츠 소재로 (픽: scenes-th-keep content-seed) 버튼도 여기 둔다.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowTopRightOnSquareIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  RectangleStackIcon,
} from "@heroicons/react/16/solid";
import { toast } from "@/components/toast";
import type { ThreadsReply } from "@/lib/threads-replies/model";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { patchReply } from "./use-threads-answer";
import { press } from "./threads-answer-verdict";

export const UNDO_MS = 5000;

export interface PendingSend {
  replyId: string;
  username: string;
  message: string;
  /** 붙인 이미지 data URL (JPG·PNG) */
  image?: string;
  /** 근거 캡처 경로 (/threads-evidence/...). image 가 없을 때 서버가 이걸 붙인다 */
  evidenceImage?: string;
}

export interface SendFailure extends PendingSend {
  kind: string;
  error: string;
  reauthUrl?: string;
}

const sendUrl = (replyId: string) => `/api/threads-replies/${encodeURIComponent(replyId)}/send`;

type QueueItemView = { replyId: string; status: "waiting" | "sending" | "sent" | "failed"; dueAt: string; error?: string; kind?: string; reauthUrl?: string; message: string };

/** [보내기]: 서버 대기열에 넣는다. 202 = 맡김(서버가 UNDO_MS 뒤 보낸다). 그 밖은 실패 이유. */
async function queueSend(p: PendingSend): Promise<{ dueAt: string } | SendFailure> {
  try {
    const res = await fetch(sendUrl(p.replyId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: p.message, image: p.image, evidenceImage: p.evidenceImage, delayMs: UNDO_MS }),
    });
    const body = (await res.json().catch(() => ({}))) as { queued?: { dueAt: string }; error?: string; kind?: string; reauthUrl?: string };
    if (res.status === 202 && body.queued) return { dueAt: body.queued.dueAt };
    return { ...p, kind: body.kind ?? "other", error: body.error ?? `보내지 못했어요 (HTTP ${res.status})`, reauthUrl: body.reauthUrl };
  } catch (e) {
    return { ...p, kind: "other", error: e instanceof Error ? e.message : String(e) };
  }
}

async function readSendStatus(replyId: string): Promise<QueueItemView | null> {
  try {
    const res = await fetch(sendUrl(replyId), { cache: "no-store" });
    return res.ok ? ((await res.json()) as { item: QueueItemView | null }).item : null;
  } catch {
    return null;
  }
}

async function readReply(replyId: string): Promise<ThreadsReply | null> {
  try {
    const res = await fetch(`/api/threads-replies/${encodeURIComponent(replyId)}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as { reply: ThreadsReply }).reply : null;
  } catch {
    return null;
  }
}

const POLL_MS = 1000;

async function announceSent(item: QueueItemView, p: PendingSend, onSent: (reply: ThreadsReply) => void) {
  if (firstNotice(item)) toast.success(`@${p.username} 님께 답글을 달았어요`);
  const reply = await readReply(p.replyId);
  if (reply) onSent(reply);
}

function announceFailed(item: QueueItemView, p: PendingSend): SendFailure {
  const error = item.error ?? "보내지 못했어요";
  if (item.kind !== "permission" && firstNotice(item)) toast.error(error);
  return { ...p, kind: item.kind ?? "other", error, reauthUrl: item.reauthUrl };
}

// 같은 결과를 두 번 알리지 않게 (열린 패널과 목록 화면의 대기열 알림이 같은 결과를 볼 수 있다)
const notified = new Set<string>();
/** 이 보내기 결과를 이미 알렸나. 처음 보는 결과면 true 를 돌려주고 알린 것으로 적는다. */
export function firstNotice(item: { replyId: string; dueAt: string; status: string }): boolean {
  const key = `${item.replyId}@${item.dueAt}:${item.status}`;
  if (notified.has(key)) return false;
  notified.add(key);
  return true;
}

/**
 * 5초 되돌리기 (2026-10-02 henry "한번 발송된 건 발송이 되어야 한다"): 시간은 서버가 잰다.
 * [보내기]를 누르면 바로 서버 대기열에 맡기고, 5초가 지나면 서버가 보낸다 — 다른 댓글로 가도·창을 닫아도 보낸다.
 * 화면은 결과만 읽어 알린다(떠난 뒤 결과는 threads-client 의 대기열 알림이 알린다). 되돌리기는 보내기 시작 전에만 된다.
 */
export function useUndoSend(onSent: (reply: ThreadsReply) => void) {
  const [pending, setPending] = useState<PendingSend | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<SendFailure | null>(null);
  const onSentRef = useRef(onSent);
  useEffect(() => {
    onSentRef.current = onSent;
  }, [onSent]);

  // 맡긴 뒤 결과를 읽는다. 패널이 사라지면 읽기만 멈추고, 보내기는 서버가 끝낸다.
  useEffect(() => {
    if (!pending) return;
    let alive = true;
    const t = setInterval(async () => {
      const item = await readSendStatus(pending.replyId);
      if (!alive || !item) return;
      setSending(item.status === "sending");
      if (item.status !== "sent" && item.status !== "failed") return;
      // 결과는 한 번만 처리한다 (앞 읽기가 끝나기 전에 다음 읽기가 같은 결과를 볼 수 있다)
      alive = false;
      clearInterval(t);
      setPending(null);
      setSending(false);
      if (item.status === "sent") await announceSent(item, pending, onSentRef.current);
      else setFailure(announceFailed(item, pending));
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pending]);

  const start = useCallback(async (p: PendingSend) => {
    setFailure(null);
    setPending(p);
    const got = await queueSend(p);
    if ("dueAt" in got) return;
    setPending(null);
    setFailure(got);
    if (got.kind !== "permission") toast.error(got.error);
  }, []);

  const undo = useCallback(async () => {
    if (!pending || sending) return;
    const res = await fetch(sendUrl(pending.replyId), { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      setPending(null);
      return;
    }
    toast.error("이미 보내는 중이라 되돌릴 수 없어요");
  }, [pending, sending]);

  /** 패널을 다시 열었을 때: 서버에서 기다리는 중이면 띠를 되살리고, 실패했으면 이유를 보여 준다. */
  const restore = useCallback(async (replyId: string, username: string) => {
    const item = await readSendStatus(replyId);
    if (!item) return;
    const p = { replyId, username, message: item.message };
    if (item.status === "waiting" || item.status === "sending") setPending(p);
    else if (item.status === "failed") setFailure({ ...p, kind: item.kind ?? "other", error: item.error ?? "보내지 못했어요", reauthUrl: item.reauthUrl });
  }, []);

  // 서버가 시간을 재므로 멈추기는 없다 (띠는 그림일 뿐)
  return { pending, paused: false, setPaused: (_: boolean) => void _, sending, failure, clearFailure: () => setFailure(null), start, undo, restore };
}

export function UndoBar({
  pending,
  paused,
  sending,
  onPause,
  onUndo,
}: {
  pending: PendingSend | null;
  paused: boolean;
  sending: boolean;
  onPause: (paused: boolean) => void;
  onUndo: () => void;
}) {
  const reduce = useReducedMotion();
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] -translate-x-1/2">
      <style>{"@keyframes th-undo-countdown{from{transform:scaleX(1)}to{transform:scaleX(0)}}"}</style>
      <AnimatePresence>
        {pending ? (
          <motion.div
            key={pending.replyId}
            role="status"
            initial={{ opacity: 0, y: reduce ? 0 : 16, scale: reduce ? 1 : 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduce ? 0 : 8, transition: spring.moderate.exit }}
            transition={spring.moderate}
            onPointerEnter={() => onPause(true)}
            onPointerLeave={() => onPause(false)}
            className="pointer-events-auto relative w-[360px] overflow-hidden rounded-xl bg-white shadow-lg shadow-neutral-950/5 ring-1 ring-neutral-950/5"
          >
            <div className="flex items-center gap-2.5 px-4 py-3">
              <PaperAirplaneIcon className="size-4 shrink-0 text-neutral-900" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-neutral-900">@{pending.username} 님께 답글을 보내요</p>
                <p className="text-[12px] text-neutral-500">
                  {sending ? "보내는 중이에요" : paused ? "멈췄어요. 손을 떼면 이어서 셉니다" : "5초 안에 되돌릴 수 있어요 · 다른 댓글로 가도 보내져요"}
                </p>
              </div>
              <button
                type="button"
                onClick={onUndo}
                disabled={sending}
                className={cn("h-7 shrink-0 rounded-md bg-emerald-700 px-2.5 text-[12px] font-medium text-white hover:bg-emerald-800 disabled:opacity-40", press)}
              >
                되돌리기
              </button>
            </div>
            <span
              aria-hidden
              style={{ animation: `th-undo-countdown ${UNDO_MS}ms linear forwards`, animationPlayState: paused || sending ? "paused" : "running" }}
              className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-emerald-500"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>,
    document.body
  );
}

/** 권한·토큰 문제로 못 보냈을 때. 스레드 앱에서 직접 달고 [달았어요]로 기록한다. */
export function SendFailureNote({
  failure,
  permalink,
  onMarked,
}: {
  failure: SendFailure;
  permalink: string | undefined;
  onMarked: (reply: ThreadsReply) => void;
}) {
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const manual = failure.kind === "permission" || failure.kind === "token";

  const copyAndOpen = async () => {
    try {
      await navigator.clipboard.writeText(failure.message);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    if (permalink) window.open(permalink, "_blank", "noopener,noreferrer");
  };

  const mark = async () => {
    setMarking(true);
    setMarkError(null);
    try {
      const { reply } = await patchReply({ replyId: failure.replyId, markedAnswered: failure.message });
      onMarked(reply);
    } catch (e) {
      setMarkError(e instanceof Error ? e.message : String(e));
    } finally {
      setMarking(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 ring-1 ring-amber-700/15">
      <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-amber-900 break-keep">
        <ExclamationTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {failure.error}
          {failure.reauthUrl ? (
            <a href={failure.reauthUrl} target="_blank" rel="noreferrer" className="ml-1 font-medium text-emerald-700 underline-offset-2 hover:underline">
              다시 인증하기
            </a>
          ) : null}
        </span>
      </p>
      {manual ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={copyAndOpen}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded-[10px] bg-white px-3 text-xs font-medium text-emerald-700 ring-1 ring-neutral-950/5 hover:bg-emerald-50", press)}
          >
            {copied === "ok" ? <CheckIcon className="size-3.5" /> : <ClipboardDocumentIcon className="size-3.5" />}
            {copied === "ok" ? "복사했어요 · 다시 열기" : "복사하고 스레드에서 열기"}
            <ArrowTopRightOnSquareIcon className="size-3 text-neutral-400" />
          </button>
          <button
            type="button"
            onClick={mark}
            disabled={marking}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded-[10px] bg-emerald-700 px-3 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50", press)}
          >
            <CheckIcon className="size-3.5" />
            달았어요
          </button>
          {copied === "fail" ? <span className="text-[11px] text-amber-800">복사가 막혔어요. 초안을 직접 선택해 복사해 주세요</span> : null}
          {markError ? <span className="text-[11px] text-rose-600">{markError}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** 답한 질문 → 콘텐츠 보드 (유료 수집 잡을 띄운다). 보낸 뒤엔 보드 링크만. */
export function SeedButton({ replyId, answer }: { replyId: string; answer: string }) {
  const reduce = useReducedMotion();
  const [state, setState] = useState<"idle" | "sending" | "started">("idle");
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setState("sending");
    setError(null);
    try {
      const res = await fetch(`/api/threads-replies/${encodeURIComponent(replyId)}/to-board`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `보내지 못했어요 (HTTP ${res.status})`);
      setState("started");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  };

  return (
    <div className="flex min-h-9 items-center gap-2">
      <AnimatePresence mode="wait" initial={false}>
        {state === "started" ? (
          <motion.span
            key="started"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={spring.moderate}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
            보드에서 만드는 중
            <Link href="/content-ideas" className="inline-flex items-center gap-0.5 font-normal text-neutral-500 hover:text-emerald-700">
              콘텐츠 보드 열기
              <ArrowTopRightOnSquareIcon className="size-3" />
            </Link>
          </motion.span>
        ) : (
          <motion.span key="idle" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={spring.fast}>
            <button
              type="button"
              onClick={send}
              disabled={state === "sending" || !answer.trim()}
              className={cn("inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-xs font-medium text-emerald-700 ring-1 ring-neutral-950/5 hover:bg-emerald-50 disabled:opacity-40", press)}
            >
              <RectangleStackIcon className="size-3.5" />
              {state === "sending" ? "보내는 중..." : "콘텐츠 보드로"}
            </button>
          </motion.span>
        )}
      </AnimatePresence>
      {error ? <span className="text-[11px] text-rose-600">{error}</span> : null}
    </div>
  );
}
