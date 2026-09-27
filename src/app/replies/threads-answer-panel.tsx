"use client";

// 스레드 댓글 답 패널 (오른쪽). 목록은 다른 파일이 그리고, 이 패널은 댓글 한 건을 받아
// 판정·근거·초안 → 근거 확인 → 5초 되돌리기 보내기 → 다음 질문까지 맡는다.
// 답한 질문(기록 보기)도 같은 패널: 보낸 답 + [콘텐츠 보드로].

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowTopRightOnSquareIcon, ArrowUturnLeftIcon, CheckIcon, ForwardIcon, PaperAirplaneIcon } from "@heroicons/react/16/solid";
import type { ThreadsReply } from "@/lib/threads-replies/model";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { EvidenceStrip } from "./threads-answer-evidence";
import { ThreadsDraftCard } from "./threads-answer-draft";
import { ReplyImageRow, useReplyImage } from "./threads-answer-image";
import { useCanAttach } from "./threads-mark";
import { SeedButton, SendFailureNote, UndoBar, useUndoSend, type PendingSend } from "./threads-answer-send";
import { SourceChips, press } from "./threads-answer-verdict";
import { isShootableSource, patchReply, shotKey, useEvidenceShots, useThreadsAnswer, type ThreadsReplyView } from "./use-threads-answer";

function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  const min = Math.floor(ms / 60000);
  if (!Number.isFinite(min) || min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  return hr < 24 ? `${hr}시간 전` : `${Math.floor(hr / 24)}일 전`;
}

function QuestionHead({ view }: { view: ThreadsReplyView }) {
  const { reply, post, conversation } = view;
  return (
    <div className="mb-3">
      {post ? (
        <a
          href={post.permalink}
          target="_blank"
          rel="noreferrer"
          className="group flex items-center gap-1.5 px-1 text-[11.5px] text-neutral-500 hover:text-neutral-800"
        >
          <span className="shrink-0 font-medium">내 글</span>
          <span className="min-w-0 truncate">{post.text.split("\n")[0]}</span>
          <ArrowTopRightOnSquareIcon className="size-3 shrink-0 text-neutral-400 group-hover:text-neutral-600" />
        </a>
      ) : null}
      {conversation.length > 0 ? (
        <ol className="mt-2 flex flex-col gap-1 pl-3 shadow-[-1px_0_0_0_rgba(10,10,10,0.05)]">
          {conversation.map((t, i) => (
            <li key={i} className="line-clamp-2 text-[11.5px] leading-relaxed text-neutral-500 break-keep">
              <span className="font-medium text-neutral-600">@{t.username}</span> {t.text}
            </li>
          ))}
        </ol>
      ) : null}
      <div className="mt-2 rounded-xl bg-white p-3 ring-1 ring-neutral-950/5">
        <p className="text-xs">
          <span className="font-medium text-neutral-800">@{reply.username}</span>
          <span className="ml-1.5 text-neutral-500">{ago(reply.timestamp)}</span>
        </p>
        <p className="mt-0.5 whitespace-pre-line break-keep text-[13px] leading-relaxed text-neutral-700">{reply.text}</p>
      </div>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-100" />
      <div className="h-16 animate-pulse rounded-xl bg-neutral-100" />
      <div className="h-44 animate-pulse rounded-[18px] bg-neutral-100" />
    </div>
  );
}

function LoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <p className="rounded-xl bg-white px-4 py-3 text-[12px] text-rose-600 ring-1 ring-neutral-950/5">
      {error}
      <button type="button" onClick={onRetry} className="ml-2 font-medium text-emerald-700 hover:underline">
        다시 읽기
      </button>
    </p>
  );
}

function AnsweredBlock({ reply }: { reply: ThreadsReply }) {
  const [open, setOpen] = useState<string | null>(null);
  const mine = reply.myReply;
  if (!mine) return null;
  return (
    <div className="rounded-[18px] bg-white p-3 shadow-card ring-1 ring-neutral-950/5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
        <CheckIcon className="size-3.5" />
        {mine.id === "manual" ? "스레드 앱에서 직접 단 답" : "보낸 답"}
        <span className="font-normal text-neutral-500">· {ago(mine.timestamp)}</span>
      </p>
      <p className="mt-1.5 whitespace-pre-line break-keep text-[14px] leading-[1.7] text-neutral-800">{mine.text}</p>
      {reply.answer && reply.answer.sources.length > 0 ? <SourceChips answer={reply.answer} open={open} onOpen={setOpen} /> : null}
      {reply.intent === "question" ? (
        <div className="mt-3 pt-2 shadow-[0_-1px_0_0_rgba(10,10,10,0.05)]">
          <SeedButton replyId={reply.id} answer={mine.text} />
        </div>
      ) : null}
    </div>
  );
}

function SkippedBlock({ onRestore }: { onRestore: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-[18px] bg-white px-4 py-3 ring-1 ring-neutral-950/5">
      <p className="text-[13px] text-neutral-600">건너뛴 댓글이에요</p>
      <button
        type="button"
        onClick={onRestore}
        className={cn("ml-auto inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50", press)}
      >
        <ArrowUturnLeftIcon className="size-3.5" />
        되살리기
      </button>
    </div>
  );
}

function SendActions({ canSend, waiting, onSkip, onSend }: { canSend: boolean; waiting: boolean; onSkip: () => void; onSend: () => void }) {
  return (
    <>
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
    </>
  );
}

type AnswerState = ReturnType<typeof useThreadsAnswer>;
type Sender = ReturnType<typeof useUndoSend>;
type Shots = ReturnType<typeof useEvidenceShots>;

interface OpenReplyProps {
  view: ThreadsReplyView;
  a: AnswerState;
  sender: Sender;
  ev: Shots;
  onSent: (reply: ThreadsReply) => void;
  onSkip: (skipped: boolean) => void;
}

/** 근거 중 캡처가 끝난 첫 장 — 답글에 자동으로 붙는다 */
function firstEvidenceShot(reply: ThreadsReply, shots: Shots["shots"]): string | null {
  for (const s of reply.answer?.sources ?? []) {
    if (!isShootableSource(s)) continue;
    const st = shots[shotKey(reply.id, s)];
    if (st?.status === "done") return st.shot.image;
  }
  return null;
}

/** 답글 첨부: 직접 붙인 이미지가 우선, 없으면 근거 캡처가 자동으로 붙는다. */
function useReplyAttachments(reply: ThreadsReply, shots: Shots["shots"], waiting: boolean) {
  const canAttach = useCanAttach();
  const image = useReplyImage(canAttach && !waiting);
  const [evidenceOff, setEvidenceOff] = useState(false);
  const evidenceImage = evidenceOff || !canAttach ? null : firstEvidenceShot(reply, shots);
  const payload = () =>
    image.dataUrl ? { image: image.dataUrl } : evidenceImage ? { evidenceImage } : {};
  const row = !canAttach ? null : <ReplyImageRow image={image} evidence={{ image: evidenceImage, onExclude: () => setEvidenceOff(true) }} disabled={waiting} />;
  return { image, payload, row };
}

/** 아직 답하지 않은 댓글: 초안 칸 → (실패 시 폴백) → 보내기 전 근거. */
function OpenReply({ view, a, sender, ev, onSent, onSkip }: OpenReplyProps) {
  const { reply } = view;
  const isQuestion = reply.intent === "question";
  const waiting = sender.pending?.replyId === reply.id;
  const failure = sender.failure?.replyId === reply.id ? sender.failure : null;
  const attach = useReplyAttachments(reply, ev.shots, waiting);
  const canSend = (Boolean(a.draft.trim()) || Boolean(attach.image.dataUrl)) && !a.regenerating;

  const send = () => {
    if (!canSend || sender.pending) return;
    a.flushDraft();
    const p: PendingSend = { replyId: reply.id, username: reply.username, message: a.draft.trim(), ...attach.payload() };
    sender.start(p);
  };

  return (
    <>
      <ThreadsDraftCard
        answer={reply.answer}
        isQuestion={isQuestion}
        draft={a.draft}
        setDraft={a.setDraft}
        busy={a.regenerating}
        drafting={a.drafting}
        error={a.regenError}
        regenerate={(input) => void a.regenerate(input)}
        onSubmit={send}
        locked={waiting}
        onImage={attach.image.pick}
        attachment={attach.row}
        actions={<SendActions canSend={canSend} waiting={waiting} onSkip={() => onSkip(true)} onSend={send} />}
      />
      {failure ? (
        <SendFailureNote
          failure={failure}
          permalink={view.post?.permalink}
          onMarked={(r) => {
            sender.clearFailure();
            onSent(r);
          }}
        />
      ) : null}
      {isQuestion && reply.answer ? (
        <EvidenceStrip replyId={reply.id} sources={reply.answer.sources} shots={ev.shots} request={ev.request} />
      ) : null}
    </>
  );
}

function ReplyBody(props: OpenReplyProps) {
  const { reply } = props.view;
  if (reply.myReply) return <AnsweredBlock reply={reply} />;
  if (reply.skipped) return <SkippedBlock onRestore={() => props.onSkip(false)} />;
  return <OpenReply {...props} />;
}

export function ThreadsAnswerPanel({ replyId, onChanged, onNext }: { replyId: string; onChanged: () => void; onNext: () => void }) {
  const reduce = useReducedMotion();
  const a = useThreadsAnswer(replyId, onChanged);
  const ev = useEvidenceShots();
  const shown = useRef(replyId);
  useEffect(() => {
    shown.current = replyId;
  }, [replyId]);

  const { replaceReply } = a;
  const onSent = useCallback(
    (reply: ThreadsReply) => {
      replaceReply(reply);
      onChanged();
      if (shown.current === reply.id) onNext();
    },
    [replaceReply, onChanged, onNext]
  );
  const sender = useUndoSend(onSent);

  const onSkip = async (skipped: boolean) => {
    try {
      const { reply: next } = await patchReply({ replyId, skipped });
      replaceReply(next);
      onChanged();
      if (skipped) onNext();
    } catch {
      // 목록이 다시 읽을 때 원장 상태로 돌아온다
    }
  };

  const bar = <UndoBar pending={sender.pending} paused={sender.paused} sending={sender.sending} onPause={sender.setPaused} onUndo={sender.undo} />;
  const view = a.view;
  if (!view) {
    return (
      <>
        {a.error ? <LoadError error={a.error} onRetry={() => void a.reload()} /> : <PanelSkeleton />}
        {bar}
      </>
    );
  }

  return (
    <motion.div
      key={view.reply.id}
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.moderate}
      className="min-w-0"
    >
      <QuestionHead view={view} />
      <ReplyBody view={view} a={a} sender={sender} ev={ev} onSent={onSent} onSkip={(v) => void onSkip(v)} />
      {bar}
    </motion.div>
  );
}
