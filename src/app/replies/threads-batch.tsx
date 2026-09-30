"use client";

// 5개 한꺼번에 (박약사 운영자 09-29): 지금 답할 5개를 위아래로 쌓고, 댓글마다 완성된 답 칸 · [새로 쓰기] · [OK].
// OK 는 하나씩 화면과 같은 확인 시트를 연다 — api 계정은 5초 되돌리기 뒤 발송, copy 계정은 복사하고 [달았어요]로 기록.
// 고친 글은 칸을 떠날 때 원장에 저장한다.

import { notesOnly } from "@/lib/threads-replies/editor-paint";
import { useState } from "react";
import { ArrowPathIcon, CheckIcon } from "@heroicons/react/16/solid";
import type { ReplyAnswer, ThreadsReply } from "@/lib/threads-replies/model";
import { cn } from "@/lib/utils";
import { press } from "./threads-answer-verdict";
import { UndoBar, useUndoSend, type PendingSend } from "./threads-answer-send";
import { GateEditor, gateLine, type GateChecker } from "./threads-gate";
import { announceReceipt } from "./threads-receipt";
import { SendSheet, type SheetPersona } from "./threads-send-sheet";
import type { UrgentItem } from "./threads-view";
import { patchReply } from "./use-threads-answer";

const MAX_LEN = 500;

async function jsonOf<T>(r: Response): Promise<T> {
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw Object.assign(new Error(body.error ?? `HTTP ${r.status}`), { status: r.status });
  return body;
}

/** 새로 쓰기: 토글 초안기(제안 토글 그대로) → 없으면 옛 다시 쓰기 */
export async function recompose(replyId: string): Promise<string> {
  const base = `/api/threads-replies/${encodeURIComponent(replyId)}`;
  try {
    const { toggles } = await jsonOf<{ toggles?: unknown }>(await fetch(`${base}/compose`, { cache: "no-store" }));
    const { draft } = await jsonOf<{ draft: string }>(
      await fetch(`${base}/compose`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toggles: toggles ?? {} }) })
    );
    return draft;
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
  }
  const { answer } = await jsonOf<{ answer: ReplyAnswer }>(await fetch(`${base}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  return answer.draft;
}

/** 한 줄의 답 칸 상태: 고친 글 · 저장(칸을 떠날 때) · 새로 쓰기 */
function useBatchDraft(reply: ThreadsReply) {
  const first = reply.answer?.draft ?? "";
  const [draft, setDraft] = useState(first);
  const [saved, setSaved] = useState(first);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = (text: string) => {
    if (text === saved) return;
    setSaved(text);
    void patchReply({ replyId: reply.id, draft: text }).catch(() => {});
  };
  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await recompose(reply.id);
      setDraft(next);
      setSaved(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { draft, setDraft, busy, error, save, refresh };
}

/** 칸 아래 한 줄: 오류 → 빈 칸 안내 → 관문 결과 */
function statusLine(error: string, draft: string, line: { text: string; tone: string }): { text: string; tone: string } {
  if (error) return { text: error, tone: "text-amber-800" };
  if (!draft.trim()) return { text: "아직 초안이 없어요 · 새로 쓰기를 누르거나 직접 써요", tone: "text-neutral-500" };
  return line;
}

function BatchRow({ n, reply, gate, onOk, onOpen }: { n: number; reply: ThreadsReply; gate: GateChecker; onOk: (reply: ThreadsReply, draft: string) => void; onOpen: (id: string) => void }) {
  const { draft, setDraft, busy, error, save, refresh } = useBatchDraft(reply);
  // 일괄 칸엔 예전 답·자료 대조가 없다: 관문 막음만 칸 아래 한 줄로 (확인 표현은 칠하지 않는다)
  const result = notesOnly(gate.check(draft));
  const status = statusLine(error, draft, gateLine(result, gate.mode));
  const canOk = Boolean(draft.trim()) && !busy && result.status !== "block" && draft.length <= MAX_LEN;

  return (
    <li className="grid grid-cols-1 gap-3 rounded-[18px] bg-white p-3 ring-1 ring-neutral-950/5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-xs">
          <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-neutral-950/[0.05] text-[10.5px] font-semibold tabular-nums text-neutral-600">{n}</span>
          <span className="font-medium text-neutral-800">@{reply.username}</span>
          <button type="button" onClick={() => onOpen(reply.id)} className="ml-auto text-[11px] text-neutral-500 hover:text-emerald-700">
            하나씩 열기
          </button>
        </p>
        <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-neutral-700 break-keep">{reply.text}</p>
      </div>
      <div className={cn("relative min-w-0 rounded-[14px] bg-neutral-950/[0.02] ring-1 ring-neutral-950/5 transition-opacity duration-200", busy && "opacity-60")}>
        <div onBlur={() => save(draft)}>
          <GateEditor
            label={`@${reply.username} 님께 보낼 답`}
            value={draft}
            onChange={setDraft}
            result={result}
            readOnly={busy}
            placeholder={busy ? "새로 쓰는 중이에요" : "답을 써 주세요"}
            onSubmit={() => canOk && onOk(reply, draft)}
            className="whitespace-pre-wrap break-keep px-3 pb-2 pt-2.5 text-[14px] leading-[1.65] text-neutral-800 [overflow-wrap:anywhere]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
          <span className={cn("min-w-0 flex-1 truncate px-1 text-[11px]", status.tone)}>{status.text}</span>
          <span className={cn("text-[11px] tabular-nums", draft.length > MAX_LEN ? "text-amber-700" : "text-neutral-400")}>{draft.length}자</span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40", press)}
          >
            <ArrowPathIcon className={cn("size-3.5", busy && "animate-spin")} />
            새로 쓰기
          </button>
          <button
            type="button"
            onClick={() => {
              save(draft);
              onOk(reply, draft);
            }}
            disabled={!canOk}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded-[10px] bg-emerald-700 px-3.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-40", press)}
          >
            <CheckIcon className="size-3.5" />
            OK
          </button>
        </div>
      </div>
    </li>
  );
}

export function ThreadsBatch({
  items,
  persona,
  gate,
  onChanged,
  onOpen,
}: {
  items: UrgentItem[];
  persona: SheetPersona;
  gate: GateChecker;
  onChanged: () => void;
  onOpen: (id: string) => void;
}) {
  const [sheet, setSheet] = useState<{ reply: ThreadsReply; message: string } | null>(null);
  const done = (reply: ThreadsReply) => {
    announceReceipt(reply.id, reply.username);
    onChanged();
  };
  const sender = useUndoSend(done);

  if (!items.length) {
    return <p className="rounded-xl bg-white px-4 py-10 text-center text-xs text-neutral-500 ring-1 ring-neutral-950/5">지금 답할 댓글이 없어요</p>;
  }
  return (
    <>
      <p className="px-1 pb-2 text-[11.5px] text-neutral-500">
        지금 답할 {items.length}개 · {persona.send === "copy" ? "OK 를 누르면 복사하고 스레드에서 단 뒤 기록해요" : "OK 를 누르면 확인하고 5초 뒤 보내요"}
      </p>
      <ol className="space-y-3">
        {items.map((it, i) => (
          <BatchRow key={it.reply.id} n={i + 1} reply={it.reply} gate={gate} onOk={(reply, message) => setSheet({ reply, message: message.trim() })} onOpen={onOpen} />
        ))}
      </ol>
      {sheet ? (
        <SendSheet
          open
          onOpenChange={(o) => (o ? null : setSheet(null))}
          persona={persona}
          replyId={sheet.reply.id}
          to={sheet.reply.username}
          message={sheet.message}
          image={null}
          gate={gate.check(sheet.message)}
          gateMode={gate.mode}
          onConfirmApi={() => {
            const p: PendingSend = { replyId: sheet.reply.id, username: sheet.reply.username, message: sheet.message };
            setSheet(null);
            sender.start(p);
          }}
          onMarked={(r) => {
            setSheet(null);
            done(r);
          }}
        />
      ) : null}
      <UndoBar pending={sender.pending} paused={sender.paused} sending={sender.sending} onPause={sender.setPaused} onUndo={sender.undo} />
    </>
  );
}
