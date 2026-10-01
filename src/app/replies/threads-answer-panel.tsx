"use client";

// 스레드 댓글 답 패널 (오른쪽). 목록은 다른 파일이 그리고, 이 패널은 댓글 한 건을 받아
// 완성된 답(칸 안 카테고리 칩 · 관문 칠하기) + 오른쪽 참고 칸(제품·비슷한 글·자료) → 확인 시트 → 보내기까지 맡는다.
// 답한 질문(기록 보기)도 같은 패널: 보낸 답 + [콘텐츠 보드로].

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowTopRightOnSquareIcon, ArrowUturnLeftIcon, CheckIcon, ChevronRightIcon } from "@heroicons/react/16/solid";
import { notesOnly } from "@/lib/threads-replies/editor-paint";
import type { ThreadsReply } from "@/lib/threads-replies/model";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { FinalAnswer } from "./threads-answer-final";
import { ReplyImageRow, useReplyImage } from "./threads-answer-image";
import { useCanAttach } from "./threads-mark";
import { AnswerSources } from "./threads-answer-sources";
import { ComposeBar } from "./threads-compose-bar";
import { SimilarPast } from "./threads-similar";
import { useCompose } from "./use-compose";
import { useGate, type GateChecker } from "./threads-gate";
import { announceReceipt, ThreadsReceipt } from "./threads-receipt";
import { SendSheet, type SheetPersona } from "./threads-send-sheet";
import { ThreadsStanceCard } from "./threads-stance-card";
import { ThreadsProducts } from "./threads-products";
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
      <ThreadsReceipt replyId={reply.id} className="mt-2" />
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

type AnswerState = ReturnType<typeof useThreadsAnswer>;
type Sender = ReturnType<typeof useUndoSend>;
type Shots = ReturnType<typeof useEvidenceShots>;

interface OpenReplyProps {
  view: ThreadsReplyView;
  a: AnswerState;
  sender: Sender;
  ev: Shots;
  persona: SheetPersona;
  gate: GateChecker;
  onSent: (reply: ThreadsReply) => void;
  onSkip: (skipped: boolean) => void;
}

/** 캡처가 끝난 근거 중 초안 문장이 가장 많이 기댄 한 장 — 답글에 자동으로 붙는다 */
function firstEvidenceShot(reply: ThreadsReply, shots: Shots["shots"]): string | null {
  const sentences = reply.answer?.sentences ?? [];
  const uses = (id: string) => sentences.filter((x) => x.sourceIds.includes(id)).length;
  const ranked = [...(reply.answer?.sources ?? [])].sort((a, b) => uses(b.id) - uses(a.id));
  for (const s of ranked) {
    if (!isShootableSource(s)) continue;
    const st = shots[shotKey(reply.id, s)];
    if (st?.status === "done") return st.shot.image;
  }
  return null;
}

/** 답글 첨부: 직접 붙인 이미지가 우선, 없으면 근거 캡처가 자동으로 붙는다. */
function useReplyAttachments(reply: ThreadsReply, shots: Shots["shots"], waiting: boolean) {
  // Cloudflare 로그인이 없으면 첨부를 올릴 곳이 없어 발송이 실패한다 — 첨부 줄을 숨긴다.
  const canAttach = useCanAttach();
  const image = useReplyImage(canAttach && !waiting);
  const [evidenceOff, setEvidenceOff] = useState(false);
  const evidenceImage = evidenceOff || !canAttach ? null : firstEvidenceShot(reply, shots);
  const payload = () => (image.dataUrl ? { image: image.dataUrl } : evidenceImage ? { evidenceImage } : {});
  const row = !canAttach ? null : <ReplyImageRow image={image} evidence={{ image: evidenceImage, onExclude: () => setEvidenceOff(true) }} disabled={waiting} />;
  return { image, payload, row, shown: image.dataUrl ?? evidenceImage, canAttach };
}

/**
 * 완성된 답 칸 아래 알림 (2026-10-01 henry "형광펜이 왜 도움이 되는지 안 와닿는다, 빼 달라"):
 * 글 위에 칠하지 않는다. 관문의 막는 표현(링크 등)만 칸 아래 한 줄로 알리고 보내기를 막는다.
 */
function noteOnly(draft: string, gate: GateChecker) {
  return notesOnly(gate.check(draft));
}

/** 보내기 흐름 상태: 첨부 · 관문 결과 · 보낼 수 있나 · 확인 시트 */
function useSendFlow({ view, a, sender, ev, gate }: Pick<OpenReplyProps, "view" | "a" | "sender" | "ev" | "gate">) {
  const { reply } = view;
  const waiting = sender.pending?.replyId === reply.id;
  const attach = useReplyAttachments(reply, ev.shots, waiting);
  const [sheet, setSheet] = useState(false);
  const result = noteOnly(a.draft, gate);
  const hasBody = Boolean(a.draft.trim()) || Boolean(attach.image.dataUrl);
  const canSend = hasBody && !a.regenerating && result.status !== "block";
  const openSheet = () => {
    if (!canSend || sender.pending) return;
    a.flushDraft();
    setSheet(true);
  };
  const confirmApi = () => {
    setSheet(false);
    const p: PendingSend = { replyId: reply.id, username: reply.username, message: a.draft.trim(), ...attach.payload() };
    sender.start(p);
  };
  return { waiting, attach, sheet, setSheet, result, canSend, openSheet, confirmApi };
}

/** 고친 뒤 [되돌리기]가 돌아갈 AI 원문. 손으로 쓴 답이면 없다. */
function aiDraftOf(answer: ThreadsReply["answer"]): string | null {
  if (!answer || answer.model === "henry") return null;
  return answer.aiDraft ?? answer.draft;
}

type Compose = ReturnType<typeof useCompose>;

/** 답 버전 버튼 (완성된 답 칸 안). 버전 초안기가 없으면 [새로 쓰기]는 옛 다시 쓰기(POST .../answer)로 간다. 손으로 쓴 답에도 둔다(고친 글은 그 버전 칸에 남는다). */
function ComposeSlot({ a, compose }: { a: AnswerState; compose: Compose }) {
  const rewrite = compose.status === "missing" && !compose.hasVariants ? () => void a.regenerate() : compose.rewrite;
  return (
    <ComposeBar
      presets={compose.presets}
      selected={compose.selected}
      ready={compose.ready}
      status={compose.status}
      note={compose.note}
      busy={a.regenerating || a.drafting}
      loadingId={compose.loadingId}
      onPick={compose.pick}
      onRewrite={rewrite}
      onRestartAll={compose.status === "missing" ? undefined : () => void compose.restartAll()}
      writingAll={compose.writingAll}
    />
  );
}

function hasSources(answer: ThreadsReply["answer"]): boolean {
  return Boolean(answer && (answer.sources.length > 0 || answer.dropped?.length));
}

/** 덜 쓰는 참고 칸은 접어 둔다. 펼쳐야 그리므로(마운트) 안 여는 칸은 서버도 안 부른다. */
function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[18px] bg-white ring-1 ring-neutral-950/5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-full items-center gap-1.5 rounded-[18px] px-3 text-left text-[12.5px] font-medium text-neutral-700 hover:bg-neutral-950/[0.02]"
      >
        <ChevronRightIcon className={cn("size-3.5 text-neutral-400 transition-transform duration-150", open && "rotate-90")} aria-hidden />
        {title}
      </button>
      {open ? <div className="px-1 pb-1">{children}</div> : null}
    </div>
  );
}

/** 완성된 답 오른쪽 참고 칸: 답에 든 제품 · 비슷한 맥락에서 남긴 글 · 가져온 자료 · (접힘) 내가 해 온 말 */
function ReferenceColumn({ view, a, ev, compose, onInsert }: Pick<OpenReplyProps, "view" | "a" | "ev"> & { compose: Compose; onInsert: (text: string) => void }) {
  const { reply } = view;
  const answer = reply.answer;
  const isQuestion = reply.intent === "question";
  return (
    <aside aria-label="참고할 내용" className="min-w-0 space-y-3">
      <ThreadsProducts draft={a.draft} fromVariant={compose.products} />
      <SimilarPast replyId={reply.id} onInsert={onInsert} />
      {isQuestion && answer && hasSources(answer) ? <AnswerSources replyId={reply.id} answer={answer} shots={ev.shots} request={ev.request} /> : null}
      {isQuestion ? (
        <Fold title="이 주제에 내가 해 온 말">
          <ThreadsStanceCard replyId={reply.id} />
        </Fold>
      ) : null}
    </aside>
  );
}

function appendText(draft: string, text: string): string {
  return draft.trim() ? `${draft.trimEnd()}\n\n${text}` : text;
}

/** 원장 초안이 이 댓글 것으로 들어왔나 + 손글인가 (버전 칸이 열 때 쓴다) */
function savedDraftOf(a: AnswerState, reply: ThreadsReply) {
  return { loaded: a.view?.reply.id === reply.id, byHand: isByHand(reply.answer) };
}

/** 손글 = 주인이 쓴 답이거나 AI 원문과 달라진 초안 (열 때 버리지 않고 그 버전 칸에 둔다) */
function isByHand(answer: ThreadsReply["answer"]): boolean {
  if (!answer) return false;
  if (answer.model === "henry") return true;
  return answer.aiDraft !== undefined && answer.draft.trim() !== answer.aiDraft.trim();
}

/** 아직 답하지 않은 댓글: 완성된 답(칩) | 참고 칸 → 확인 시트. */
function OpenReply({ view, a, sender, ev, persona, gate, onSent, onSkip }: OpenReplyProps) {
  const { reply } = view;
  const flow = useSendFlow({ view, a, sender, ev, gate });
  const failure = sender.failure?.replyId === reply.id ? sender.failure : null;
  const canMake = !reply.answer && !a.drafting && !a.regenerating;
  const compose = useCompose(reply.id, a.draft, a.setDraft, savedDraftOf(a, reply));
  const insert = (text: string) => a.setDraft(appendText(a.draft, text));

  return (
    // 09-29 henry: 완성된 답(칩 포함)이 넓게 왼쪽, 참고할 내용이 오른쪽. 좁으면 세로로 쌓는다.
    <div className="@container">
    <div className="grid grid-cols-1 items-start gap-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] @6xl:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
      <div className="min-w-0 space-y-3 @3xl:sticky @3xl:top-0">
      <FinalAnswer
        draft={a.draft}
        setDraft={a.setDraft}
        aiDraft={aiDraftOf(reply.answer)}
        gate={flow.result}
        locked={flow.waiting}
        busy={a.regenerating}
        drafting={a.drafting}
        error={a.regenError}
        canSend={flow.canSend}
        waiting={flow.waiting}
        attachment={flow.attach.row}
        toolbar={<ComposeSlot a={a} compose={compose} />}
        onImage={flow.waiting || !flow.attach.canAttach ? null : flow.attach.image.pick}
        onMakeDraft={canMake ? () => void a.regenerate() : null}
        onSkip={() => onSkip(true)}
        onSend={flow.openSheet}
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
      </div>
      <ReferenceColumn view={view} a={a} ev={ev} compose={compose} onInsert={insert} />
      <SendSheet
        open={flow.sheet}
        onOpenChange={flow.setSheet}
        persona={persona}
        replyId={reply.id}
        to={reply.username}
        message={a.draft.trim()}
        image={flow.attach.shown}
        gate={flow.result}
        permalink={view.post?.permalink}
        onConfirmApi={flow.confirmApi}
        onMarked={(r) => {
          flow.setSheet(false);
          onSent(r);
        }}
      />
    </div>
    </div>
  );
}

function ReplyBody(props: OpenReplyProps) {
  const { reply } = props.view;
  if (reply.myReply) return <AnsweredBlock reply={reply} />;
  if (reply.skipped) return <SkippedBlock onRestore={() => props.onSkip(false)} />;
  return <OpenReply {...props} />;
}

const DEFAULT_PERSONA: SheetPersona = { id: "glp1", name: "박약사", handle: "glp1.pharmacy", send: "api" };

export function ThreadsAnswerPanel({
  replyId,
  onChanged,
  onNext,
  persona = DEFAULT_PERSONA,
  gate: gateProp,
}: {
  replyId: string;
  onChanged: () => void;
  onNext: () => void;
  persona?: SheetPersona;
  gate?: GateChecker;
}) {
  const reduce = useReducedMotion();
  const ownGate = useGate(persona.id);
  const gate = gateProp ?? ownGate;
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
      announceReceipt(reply.id, reply.username);
      onChanged();
      if (shown.current === reply.id) onNext();
    },
    [replaceReply, onChanged, onNext]
  );
  const sender = useUndoSend(onSent);
  // 다시 열었을 때 서버에 맡긴 보내기가 기다리는 중이면 띠를, 실패했으면 이유를 되살린다
  const { restore } = sender;
  const username = a.view?.reply.username;
  useEffect(() => {
    if (username) void restore(replyId, username);
  }, [replyId, username, restore]);

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
      <ReplyBody view={view} a={a} sender={sender} ev={ev} persona={persona} gate={gate} onSent={onSent} onSkip={(v) => void onSkip(v)} />
      {bar}
    </motion.div>
  );
}
