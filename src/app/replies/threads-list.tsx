"use client";

// 스레드 댓글 목록 (09-27 픽: 글별 묶음 + 대화 줄기).
// 내 글 첫 줄 아래로 댓글을 묶고, 묶음 안에서는 댓글 → 내 답 → 상대 재답을 들여쓴 줄기로 그린다.
// 내 차례인 대화 줄기만 펴 두고, 나머지 한 줄 댓글은 한 줄로 접는다. 100건 넘어도 가볍게 — 행에는 레이아웃 애니메이션을 걸지 않는다.

import { createContext, memo, useContext, useMemo } from "react";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/16/solid";
import type { ReplyIntent, ThreadsReply } from "@/lib/threads-replies/model";
import type { ReplyThread } from "@/lib/threads-replies/summary";
import { ChannelMark } from "./channel-switch";
import { Avatar, relativeTime } from "./comments-shared";
import { GateText, type GateChecker } from "./threads-gate";
import { chainOf, firstLine, isExpandedThread, isFocusable, type ThreadsView, type VisibleGroup } from "./threads-view";


/** 목록 전체가 같이 쓰는 것: 지금 계정 핸들(내 답 줄기)과 관문 검사기(초안 칠하기) */
interface ListEnv {
  handle: string;
  gate: GateChecker | null;
}
const ListEnvContext = createContext<ListEnv>({ handle: "", gate: null });

/** 초안 한 줄 — 관문에 걸린 표현은 칠해서 */
function DraftLine({ draft, className }: { draft: string; className: string }) {
  const { gate } = useContext(ListEnvContext);
  return <GateText text={draft} hits={gate ? gate.check(draft).hits : []} className={className} />;
}

const INTENT_LABEL: Record<ReplyIntent, string> = { question: "질문", conversation: "대화", chat: "말 걸기", reaction: "반응" };

function IntentChip({ intent }: { intent: ReplyIntent }) {
  const tone = intent === "question" ? "bg-amber-50 text-amber-700 font-medium" : "bg-neutral-100 text-neutral-500";
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${tone}`}>{INTENT_LABEL[intent]}</span>;
}

/** 오른쪽 패널로 열 수 있는 행이면 버튼, 아니면 맥락으로만 보이는 칸 */
function Pressable({
  reply,
  focusable,
  selected,
  onSelect,
  className,
  children,
}: {
  reply: ThreadsReply;
  focusable: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  className: string;
  children: React.ReactNode;
}) {
  if (!focusable) return <div className={`${className} opacity-70`}>{children}</div>;
  return (
    <button
      type="button"
      data-reply-id={reply.id}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(reply.id)}
      className={`${className} w-full text-left transition-[background-color,scale] duration-150 active:scale-[0.98] ${
        selected ? "bg-emerald-50" : "hover:bg-neutral-950/[0.03]"
      }`}
    >
      {children}
    </button>
  );
}

function DraftPreview({ reply }: { reply: ThreadsReply }) {
  const draft = reply.answer?.draft;
  if (!draft || reply.myReply || reply.skipped) return null;
  return <DraftLine draft={draft} className="mt-1 block truncate text-[11px] text-emerald-700" />;
}

function Meta({ reply }: { reply: ThreadsReply }) {
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-[11px]">
      <span className="truncate font-medium text-neutral-800">@{reply.username}</span>
      <IntentChip intent={reply.intent} />
      {reply.skipped ? <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">건너뜀</span> : null}
      <span className="ml-auto shrink-0 tabular-nums text-neutral-500">{relativeTime(reply.timestamp)}</span>
    </p>
  );
}

function MeNode({ text }: { text: string }) {
  const { handle } = useContext(ListEnvContext);
  return (
    <div className="flex gap-2 px-2 py-1.5">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[#00BD7D] text-[10px] font-semibold text-white">
        나
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-neutral-800">@{handle}</p>
        <p className="line-clamp-2 whitespace-pre-line break-keep text-xs leading-relaxed text-neutral-600">{text}</p>
      </div>
    </div>
  );
}

type RowProps = { view: ThreadsView; selectedId: string | null; onSelect: (id: string) => void };

/** 펴 둔 줄기: 칸마다 한 단씩 들여쓰고 왼쪽에 가는 선 */
function ThreadChain({ thread, view, selectedId, onSelect }: { thread: ReplyThread } & RowProps) {
  const nodes = chainOf(thread);
  return (
    <div className="space-y-0.5">
      {nodes.map((n, i) => {
        const indent = Math.min(i, 3) * 14;
        return (
          <div key={n.kind === "me" ? n.key : n.reply.id} className="relative" style={{ paddingLeft: indent }}>
            {i > 0 ? <span aria-hidden className="absolute bottom-1.5 top-1.5 w-px bg-neutral-950/10" style={{ left: indent - 7 }} /> : null}
            {n.kind === "me" ? (
              <MeNode text={n.text} />
            ) : (
              <Pressable
                reply={n.reply}
                focusable={isFocusable(n.reply, view)}
                selected={n.reply.id === selectedId}
                onSelect={onSelect}
                className="flex gap-2 rounded-lg px-2 py-1.5"
              >
                <Avatar username={n.reply.username} size="sm" />
                <span className="block min-w-0 flex-1">
                  <Meta reply={n.reply} />
                  <span className="mt-0.5 line-clamp-2 block whitespace-pre-line break-keep text-xs leading-relaxed text-neutral-600">
                    {n.reply.text}
                  </span>
                  <DraftPreview reply={n.reply} />
                </span>
              </Pressable>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 접힌 한 줄 댓글 */
function ThreadLine({ thread, view, selectedId, onSelect }: { thread: ReplyThread } & RowProps) {
  const reply = [thread.root, ...thread.followUps].find((r) => isFocusable(r, view)) ?? thread.root;
  return (
    <Pressable
      reply={reply}
      focusable={isFocusable(reply, view)}
      selected={reply.id === selectedId}
      onSelect={onSelect}
      className="block rounded-lg px-2 py-1.5"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Avatar username={reply.username} size="sm" />
        <span className="shrink-0 text-[11px] font-medium text-neutral-800">@{reply.username}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-neutral-600">{reply.text}</span>
        {reply.intent === "question" ? <IntentChip intent="question" /> : null}
        <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">{relativeTime(reply.timestamp)}</span>
      </span>
      {reply.answer?.draft && !reply.myReply ? (
        <DraftLine draft={reply.answer.draft} className="mt-0.5 block truncate pl-9 text-[11px] text-emerald-700" />
      ) : null}
    </Pressable>
  );
}

function PostHead({ group }: { group: VisibleGroup }) {
  const { post } = group;
  return (
    <div className="flex items-center gap-2 px-2 pb-2 pt-1 shadow-[0_1px_0_0_rgba(10,10,10,0.05)]">
      <ChannelMark channel="threads" size={14} className="text-neutral-500" />
      <p className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-700" title={post.text}>
        {firstLine(post.text)}
      </p>
      {group.questions ? (
        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">질문 {group.questions}</span>
      ) : null}
      <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">
        {relativeTime(post.timestamp)} · 댓글 {group.total}
      </span>
      {post.permalink ? (
        <a
          href={post.permalink}
          target="_blank"
          rel="noreferrer"
          aria-label="스레드에서 글 열기"
          className="-mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-[color,background-color,scale] duration-150 hover:bg-neutral-950/[0.04] hover:text-neutral-700 active:scale-[0.97]"
        >
          <ArrowTopRightOnSquareIcon className="size-3.5" />
        </a>
      ) : null}
    </div>
  );
}

const PostGroupCard = memo(function PostGroupCard({ group, view, selectedId, onSelect }: { group: VisibleGroup } & RowProps) {
  return (
    <section className="rounded-xl bg-white p-1.5 ring-1 ring-neutral-950/5">
      <PostHead group={group} />
      <div className="mt-1 space-y-0.5">
        {group.threads.map((t, i) =>
          isExpandedThread(t, view) ? (
            <div key={t.root.id} className={`py-0.5 ${i > 0 ? "shadow-[0_-1px_0_0_rgba(10,10,10,0.05)]" : ""}`}>
              <ThreadChain thread={t} view={view} selectedId={selectedId} onSelect={onSelect} />
            </div>
          ) : (
            <ThreadLine key={t.root.id} thread={t} view={view} selectedId={selectedId} onSelect={onSelect} />
          )
        )}
      </div>
    </section>
  );
});

export function ThreadsList({
  groups,
  view,
  selectedId,
  onSelect,
  groupOf,
  handle,
  gate,
}: RowProps & {
  /** 지금 계정 핸들 (@ 없이) — 내 답 줄기에 쓴다 */
  handle: string;
  gate: GateChecker | null;
  groups: VisibleGroup[];
  /** 댓글 id → 글 id. 고른 댓글이 없는 묶음은 selectedId 를 null 로 받아 다시 그리지 않는다 */
  groupOf: Map<string, string>;
}) {
  const selectedPost = selectedId ? groupOf.get(selectedId) : undefined;
  const env = useMemo(() => ({ handle, gate }), [handle, gate]);
  return (
    <ListEnvContext.Provider value={env}>
      <div className="space-y-3">
      {groups.map((g) => (
        <PostGroupCard
          key={g.post.id}
          group={g}
          view={view}
          selectedId={g.post.id === selectedPost ? selectedId : null}
          onSelect={onSelect}
        />
        ))}
      </div>
    </ListEnvContext.Provider>
  );
}
