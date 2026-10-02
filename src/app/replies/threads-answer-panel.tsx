"use client";

// 스레드 댓글 답 패널 (오른쪽). 목록은 다른 파일이 그리고, 이 패널은 댓글 한 건을 받아
// 완성된 답(칸 안 카테고리 칩 · 관문 칠하기) + 오른쪽 참고 칸(제품·비슷한 글·자료) → 확인 시트 → 보내기까지 맡는다.
// 답한 질문(기록 보기)도 같은 패널: 보낸 답 + [콘텐츠 보드로].

import { useCanAttach } from "./threads-mark";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowTopRightOnSquareIcon,
  ArrowUturnLeftIcon,
  CheckIcon,
} from "@heroicons/react/16/solid";
import { notesOnly } from "@/lib/threads-replies/editor-paint";
import type { AnswerSource, ThreadsReply } from "@/lib/threads-replies/model";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { FinalAnswer, type ThreadSide } from "./threads-answer-final";
import { ReplyImageRow, useReplyImage } from "./threads-answer-image";
import { ComposeBar } from "./threads-compose-bar";
import { SimilarPast } from "./threads-similar";
import { useAutoShots } from "./threads-answer-evidence";
import { useCompose } from "./use-compose";
import { useGate, type GateChecker } from "./threads-gate";
import { announceReceipt, ThreadsReceipt } from "./threads-receipt";
import { SendSheet, type SheetPersona } from "./threads-send-sheet";
import {
  SeedButton,
  SendFailureNote,
  useUndoSend,
  type PendingSend,
} from "./threads-answer-send";
import { SourceChips, press } from "./threads-answer-verdict";
import {
  isShootableSource,
  patchReply,
  shotKey,
  useEvidenceShots,
  useThreadsAnswer,
  type ThreadsReplyView,
} from "./use-threads-answer";

function ago(iso: string): string {
  const ms =
    Date.now() - Date.parse(iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  const min = Math.floor(ms / 60000);
  if (!Number.isFinite(min) || min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  return hr < 24 ? `${hr}시간 전` : `${Math.floor(hr / 24)}일 전`;
}

/** 내 글 · 앞선 대화 · (아직 안 답한 댓글이 아니면) 그 댓글 카드. 안 답한 댓글은 답 칸 안 스레드 모양에 들어간다 */
function QuestionHead({
  view,
  inThread,
}: {
  view: ThreadsReplyView;
  inThread: boolean;
}) {
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
            <li
              key={i}
              className="line-clamp-2 text-[11.5px] leading-relaxed text-neutral-500 break-keep"
            >
              <span className="font-medium text-neutral-600">
                @{t.username}
              </span>{" "}
              {t.text}
            </li>
          ))}
        </ol>
      ) : null}
      {inThread ? null : (
        <div className="mt-2 rounded-xl bg-white p-3 ring-1 ring-neutral-950/5">
          <p className="text-xs">
            <span className="font-medium text-neutral-800">
              @{reply.username}
            </span>
            <span className="ml-1.5 text-neutral-500">
              {ago(reply.timestamp)}
            </span>
          </p>
          <p className="mt-0.5 whitespace-pre-line break-keep text-[13px] leading-relaxed text-neutral-700">
            {reply.text}
          </p>
        </div>
      )}
    </div>
  );
}

const MARKS: Record<string, string> = { aicc: "A", glp1: "약" };

/** 이 댓글에서 난 보내기 실패만 */
function failureFor(sender: Sender, replyId: string) {
  return sender.failure?.replyId === replyId ? sender.failure : null;
}

/** 답 칸 스레드 모양에 들어갈 상대 댓글과 내 계정 */
function threadSideOf(reply: ThreadsReply, persona: SheetPersona): ThreadSide {
  return {
    them: { username: reply.username, when: ago(reply.timestamp), text: reply.text, href: reply.permalink },
    me: { handle: persona.handle, mark: MARKS[persona.id] ?? persona.name.slice(0, 1) },
  };
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
      <button
        type="button"
        onClick={onRetry}
        className="ml-2 font-medium text-emerald-700 hover:underline"
      >
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
        <span className="font-normal text-neutral-500">
          · {ago(mine.timestamp)}
        </span>
      </p>
      <p className="mt-1.5 whitespace-pre-line break-keep text-[14px] leading-[1.7] text-neutral-800">
        {mine.text}
      </p>
      {reply.answer && reply.answer.sources.length > 0 ? (
        <SourceChips answer={reply.answer} open={open} onOpen={setOpen} />
      ) : null}
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
        className={cn(
          "ml-auto inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50",
          press,
        )}
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
function firstEvidenceShot(
  reply: ThreadsReply,
  shots: Shots["shots"],
): string | null {
  const sentences = reply.answer?.sentences ?? [];
  const uses = (id: string) =>
    sentences.filter((x) => x.sourceIds.includes(id)).length;
  const ranked = [...(reply.answer?.sources ?? [])].sort(
    (a, b) => uses(b.id) - uses(a.id),
  );
  for (const s of ranked) {
    if (!isShootableSource(s)) continue;
    const st = shots[shotKey(reply.id, s)];
    if (st?.status === "done") return st.shot.image;
  }
  return null;
}

/**
 * 답글 첨부: 직접 붙인 이미지가 우선, 없으면 근거 캡처가 자동으로 붙는다.
 * 복사해서 다는 계정(박약사)은 이미지를 못 실어 보내니 첨부 줄을 통째로 끈다 (10-02 henry).
 */
function useReplyAttachments(
  reply: ThreadsReply,
  shots: Shots["shots"],
  waiting: boolean,
  wanted: boolean,
) {
  // Cloudflare 로그인이 없으면 첨부를 올릴 곳이 없어 발송이 실패한다 — 첨부 줄을 숨긴다.
  const enabled = useCanAttach() && wanted;
  const image = useReplyImage(enabled && !waiting);
  const [evidenceOff, setEvidenceOff] = useState(false);
  const evidenceImage = !enabled || evidenceOff ? null : firstEvidenceShot(reply, shots);
  const payload = () =>
    image.dataUrl
      ? { image: image.dataUrl }
      : evidenceImage
        ? { evidenceImage }
        : {};
  const row = enabled && (
    <ReplyImageRow
      image={image}
      evidence={{ image: evidenceImage, onExclude: () => setEvidenceOff(true) }}
      disabled={waiting}
    />
  );
  return { image, payload, row, shown: image.dataUrl ?? evidenceImage };
}

/**
 * 완성된 답 칸 아래 알림 (2026-10-01 henry "형광펜이 왜 도움이 되는지 안 와닿는다, 빼 달라"):
 * 글 위에 칠하지 않는다. 관문의 막는 표현(링크 등)만 칸 아래 한 줄로 알리고 보내기를 막는다.
 */
function noteOnly(draft: string, gate: GateChecker) {
  return notesOnly(gate.check(draft));
}

/** 보내기 흐름 상태: 첨부 · 관문 결과 · 보낼 수 있나 · 확인 시트 */
function useSendFlow({
  view,
  a,
  sender,
  ev,
  gate,
  direct,
}: Pick<OpenReplyProps, "view" | "a" | "sender" | "ev" | "gate"> & { direct: boolean }) {
  const { reply } = view;
  const waiting = sender.pending?.replyId === reply.id;
  const attach = useReplyAttachments(reply, ev.shots, waiting, direct);
  const [sheet, setSheet] = useState(false);
  const result = noteOnly(a.draft, gate);
  const hasBody = Boolean(a.draft.trim()) || Boolean(attach.image.dataUrl);
  const canSend = hasBody && !a.regenerating && result.status !== "block";
  // 바로 보내는 계정은 확인 창을 건너뛴다 — 답 칸이 이미 스레드 모양 미리보기고(10-02 henry "바로바로")
  const openSheet = () => {
    if (!canSend || sender.pending) return;
    a.flushDraft();
    if (direct) confirmApi();
    else setSheet(true);
  };
  function confirmApi() {
    setSheet(false);
    const p: PendingSend = {
      replyId: reply.id,
      username: reply.username,
      message: a.draft.trim(),
      ...attach.payload(),
    };
    sender.start(p);
  }
  return {
    waiting,
    attach,
    sheet,
    setSheet,
    result,
    canSend,
    openSheet,
    confirmApi,
  };
}

/** 고친 뒤 [되돌리기]가 돌아갈 AI 원문. 손으로 쓴 답이면 없다. */
function aiDraftOf(answer: ThreadsReply["answer"]): string | null {
  if (!answer || answer.model === "henry") return null;
  return answer.aiDraft ?? answer.draft;
}

type Compose = ReturnType<typeof useCompose>;

/** 답 버전 버튼 (완성된 답 칸 안). 버전 초안기가 없으면 [새로 쓰기]는 옛 다시 쓰기(POST .../answer)로 간다. 손으로 쓴 답에도 둔다(고친 글은 그 버전 칸에 남는다). */
function ComposeSlot({ a, compose }: { a: AnswerState; compose: Compose }) {
  const rewrite =
    compose.status === "missing" && !compose.hasVariants
      ? () => void a.regenerate()
      : compose.rewrite;
  return (
    <ComposeBar
      presets={compose.presets}
      selected={compose.selected}
      ready={compose.ready}
      status={compose.status}
      note={compose.note}
      busy={a.regenerating || a.drafting}
      loadingIds={compose.loadingIds}
      onPick={compose.pick}
      onRewrite={rewrite}
      writingAll={compose.writingAll}
    />
  );
}

/**
 * 완성된 답 오른쪽 참고 칸 (2026-10-02 henry "정말 필요한 기능만, 이전 댓글 말고는 굳이 볼 필요 없다"):
 * 비슷한 맥락에서 예전에 단 답만 둔다. 제품·가져온 자료·팟캐스트·"이 주제에 내가 해 온 말"은 뺐다
 * (근거 캡처를 답글에 붙이는 일은 화면에 안 보여도 그대로 한다).
 */
function ReferenceColumn({
  view,
  persona,
  onInsert,
}: Pick<OpenReplyProps, "view" | "persona"> & { onInsert: (text: string) => void }) {
  return (
    <aside aria-label="참고할 내용" className="min-w-0 space-y-3 @3xl:max-h-[calc(100dvh-11.5rem)] @3xl:overflow-y-auto @3xl:overscroll-contain @3xl:pb-6">
      <SimilarPast replyId={view.reply.id} me={threadSideOf(view.reply, persona).me} onInsert={onInsert} />
    </aside>
  );
}

function appendText(draft: string, text: string): string {
  return draft.trim() ? `${draft.trimEnd()}\n\n${text}` : text;
}

/** 원장 초안이 이 댓글 것으로 들어왔나 + 손글인가 (버전 칸이 열 때 쓴다) */
function savedDraftOf(a: AnswerState, reply: ThreadsReply) {
  return {
    loaded: a.view?.reply.id === reply.id,
    byHand: isByHand(reply.answer),
  };
}

/** 손글 = 주인이 쓴 답이거나 AI 원문과 달라진 초안 (열 때 버리지 않고 그 버전 칸에 둔다) */
function isByHand(answer: ThreadsReply["answer"]): boolean {
  if (!answer) return false;
  if (answer.model === "henry") return true;
  return (
    answer.aiDraft !== undefined &&
    answer.draft.trim() !== answer.aiDraft.trim()
  );
}

/** 아직 답하지 않은 댓글: 완성된 답(칩) | 참고 칸 → 확인 시트. */
const NO_SOURCES: AnswerSource[] = [];

/** 초안 문장이 기댄 자료만 (자료 칸은 안 보여도 그 자료의 형광 캡처는 찍어 둔다 — 답글에 자동으로 붙는다) */
function usedSources(answer: ThreadsReply["answer"]): AnswerSource[] {
  if (!answer) return NO_SOURCES;
  const uses = new Set(answer.sentences.flatMap((x) => x.sourceIds));
  return answer.sources.filter((s) => uses.has(s.id));
}

function OpenReply({
  view,
  a,
  sender,
  ev,
  persona,
  gate,
  onSent,
  onSkip,
}: OpenReplyProps) {
  const { reply } = view;
  const used = useMemo(() => usedSources(reply.answer), [reply.answer]);
  useAutoShots(reply.id, used, ev.request);
  const flow = useSendFlow({ view, a, sender, ev, gate, direct: persona.send === "api" });
  const failure = failureFor(sender, reply.id);
  const compose = useCompose(
    reply.id,
    a.draft,
    a.setDraft,
    savedDraftOf(a, reply),
  );
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
            onImage={flow.waiting ? null : flow.attach.image.pick}
            // [초안 만들기]는 옛 3벌 잡을 불렀다 — 그 글은 이제 쓰지 않는다(usable-draft). 버전 버튼·[새로 쓰기]가 대신한다 (10-02)
            onMakeDraft={null}
            onSkip={() => onSkip(true)}
            onSend={flow.openSheet}
            thread={{
              them: {
                username: reply.username,
                when: ago(reply.timestamp),
                text: reply.text,
                // 이 댓글 자체의 주소만 (10-02 henry: 내 글이 아니라 그 댓글로). 없으면 링크를 안 단다
                href: reply.permalink,
              },
              me: {
                handle: persona.handle,
                mark: MARKS[persona.id] ?? persona.name.slice(0, 1),
              },
            }}
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
        <ReferenceColumn view={view} persona={persona} onInsert={insert} />
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
  if (reply.skipped)
    return <SkippedBlock onRestore={() => props.onSkip(false)} />;
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
  /** 스레드에서 직접 달고 [달았어요] (복사 계정·권한 폴백) — 기록하고 다음 댓글로 */
  const onSent = useCallback(
    (reply: ThreadsReply) => {
      replaceReply(reply);
      announceReceipt(reply.id, reply.username);
      onChanged();
      if (shown.current === reply.id) onNext();
    },
    [replaceReply, onChanged, onNext],
  );
  /** 서버가 맡은 보내기가 끝남 — 이미 다음 댓글로 넘어갔으니 기록만 (10-02) */
  const onQueuedSent = useCallback(
    (reply: ThreadsReply) => {
      replaceReply(reply);
      announceReceipt(reply.id, reply.username);
      onChanged();
    },
    [replaceReply, onChanged],
  );
  /** [보내기]로 서버 대기열에 맡기면 기다리지 않고 바로 다음 댓글로 (10-02 henry "빨리 빨리") */
  const onQueued = useCallback(() => {
    if (shown.current === replyId) onNext();
  }, [replyId, onNext]);
  const sender = useUndoSend(onQueuedSent, onQueued);
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

  // 보내기 결과 알림은 목록 화면의 use-send-notices 가 한다 — 다음 댓글로 넘어가도 (10-02)
  const bar = null;

  const view = a.view;
  if (!view) {
    return (
      <>
        {a.error ? (
          <LoadError error={a.error} onRetry={() => void a.reload()} />
        ) : (
          <PanelSkeleton />
        )}
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
      <QuestionHead
        view={view}
        inThread={!view.reply.myReply && !view.reply.skipped}
      />
      <ReplyBody
        view={view}
        a={a}
        sender={sender}
        ev={ev}
        persona={persona}
        gate={gate}
        onSent={onSent}
        onSkip={(v) => void onSkip(v)}
      />
      {bar}
    </motion.div>
  );
}
