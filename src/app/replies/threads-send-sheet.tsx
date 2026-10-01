"use client";

// 확인 시트 (시안 픽 14 sd-sheet). [보내기]를 누르면 스레드 모양 최종 미리보기 · 관문 결과 · 첨부를 보고 확정한다.
//  · api 계정(AICC): [보내기] → 시트가 닫히고 5초 되돌리기 띠 → 시간이 다 되면 그때 서버가 보낸다.
//  · copy 계정(박약사): [복사하고 스레드 열기] → 서버가 관문을 다시 돌고 보낼 글을 돌려준다(올리지 않음)
//    → 클립보드에 넣고 원글을 연다 → 스레드에서 단 뒤 [달았어요]로 기록한다 (PATCH markedAnswered).

import { useState } from "react";
import { ArrowTopRightOnSquareIcon, CheckIcon, ClipboardDocumentIcon, PaperAirplaneIcon } from "@heroicons/react/16/solid";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { GateResult, ThreadsReply } from "@/lib/threads-replies/model";
import { cn } from "@/lib/utils";
import { press } from "./threads-answer-verdict";
import { GateText, gateLine } from "./threads-gate";
import { patchReply } from "./use-threads-answer";

export interface SheetPersona {
  id: string;
  name: string;
  handle: string;
  send: "api" | "copy";
}

const MARKS: Record<string, string> = { glp1: "약" };

function Preview({ persona, to, message, image, gate }: { persona: SheetPersona; to: string; message: string; image: string | null; gate: GateResult }) {
  return (
    <div className="rounded-[14px] bg-white p-3 ring-1 ring-neutral-950/5">
      <div className="flex gap-2.5">
        <span
          aria-hidden
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-medium text-white",
            persona.id === "me" ? "bg-neutral-900" : "bg-emerald-700"
          )}
        >
          {MARKS[persona.id] ?? persona.name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[13px]">
            <span className="font-semibold text-neutral-900">{persona.handle}</span>
            <span className="text-neutral-400">방금</span>
          </p>
          <p className="text-[11.5px] text-neutral-500">@{to} 님에게 답글</p>
          <GateText
            text={message}
            hits={gate.hits}
            className="mt-1.5 block whitespace-pre-line text-[14px] leading-[1.6] text-neutral-900 break-keep"
          />
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element -- 붙일 이미지 미리보기 (data URL·로컬 캡처)
            <img src={image} alt="같이 올라갈 이미지" className="mt-2 max-h-48 rounded-[10px] object-cover object-top outline outline-1 -outline-offset-1 outline-black/10" />
          ) : null}
        </div>
      </div>
    </div>
  );
}

type CopyStage = { kind: "idle" } | { kind: "working" } | { kind: "copied"; copied: boolean; permalink?: string } | { kind: "error"; message: string; gate?: GateResult };

async function requestCopy(replyId: string, message: string): Promise<{ text: string; permalink?: string } | { error: string; gate?: GateResult }> {
  try {
    const res = await fetch(`/api/threads-replies/${encodeURIComponent(replyId)}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const body = (await res.json().catch(() => ({}))) as { mode?: string; text?: string; permalink?: string; error?: string; gate?: GateResult };
    if (res.ok && body.mode === "copy") return { text: body.text ?? message, permalink: body.permalink };
    return { error: body.error ?? `복사할 글을 받지 못했어요 (HTTP ${res.status})`, gate: body.gate };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function useCopyFlow(replyId: string, message: string, fallbackLink: string | undefined, onMarked: (r: ThreadsReply) => void) {
  const [stage, setStage] = useState<CopyStage>({ kind: "idle" });
  const [marking, setMarking] = useState(false);
  const copy = async () => {
    setStage({ kind: "working" });
    const got = await requestCopy(replyId, message);
    if ("error" in got) return setStage({ kind: "error", message: got.error, gate: got.gate });
    let copied = true;
    try {
      await navigator.clipboard.writeText(got.text);
    } catch {
      copied = false;
    }
    const link = got.permalink ?? fallbackLink;
    if (link) window.open(link, "_blank", "noopener,noreferrer");
    setStage({ kind: "copied", copied, permalink: link });
  };
  const mark = async () => {
    setMarking(true);
    try {
      const { reply } = await patchReply({ replyId, markedAnswered: message });
      onMarked(reply);
    } catch (e) {
      setStage({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setMarking(false);
    }
  };
  return { stage, marking, copy, mark };
}

const btn = "inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3.5 text-xs font-medium";

type CopyFlow = ReturnType<typeof useCopyFlow>;

function StageNote({ stage }: { stage: CopyStage }) {
  if (stage.kind === "error") {
    const hits = stage.gate?.hits ?? [];
    return (
      <p className="rounded-[10px] bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900 break-keep">
        {stage.message}
        {hits.length ? ` (${hits.map((h) => `“${h.phrase}”`).join(", ")})` : ""}
      </p>
    );
  }
  if (stage.kind !== "copied") return null;
  return (
    <p className="rounded-[10px] bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">
      {stage.copied ? "복사했어요. 스레드에서 붙여 넣고 단 뒤 [달았어요]를 눌러 주세요." : "복사가 막혔어요. 미리보기 글을 직접 골라 복사해 주세요."}
    </p>
  );
}

const primary = cn(btn, "bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40", press);

function CopyActions({ flow, blocked }: { flow: CopyFlow; blocked: boolean }) {
  const { stage } = flow;
  if (stage.kind === "copied") {
    return (
      <>
        <button type="button" onClick={() => void flow.copy()} className={cn(btn, "text-emerald-700 ring-1 ring-neutral-950/5 hover:bg-emerald-50", press)}>
          <ArrowTopRightOnSquareIcon className="size-3.5" />
          다시 복사하고 열기
        </button>
        <button type="button" onClick={() => void flow.mark()} disabled={flow.marking} className={primary}>
          <CheckIcon className="size-3.5" />
          달았어요
        </button>
      </>
    );
  }
  const working = stage.kind === "working";
  return (
    <button type="button" onClick={() => void flow.copy()} disabled={blocked || working} className={primary}>
      <ClipboardDocumentIcon className="size-3.5" />
      {working ? "관문 확인 중" : "복사하고 스레드 열기"}
    </button>
  );
}

export function SendSheet({
  open,
  onOpenChange,
  persona,
  replyId,
  to,
  message,
  image,
  gate,
  permalink,
  onConfirmApi,
  onMarked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  persona: SheetPersona;
  replyId: string;
  to: string;
  message: string;
  image: string | null;
  gate: GateResult;
  permalink?: string;
  /** api 계정: 확정 → 5초 되돌리기 시작 */
  onConfirmApi: () => void;
  /** copy 계정: [달았어요] 기록 끝 */
  onMarked: (reply: ThreadsReply) => void;
}) {
  const copyMode = persona.send === "copy";
  const flow = useCopyFlow(replyId, message, permalink, onMarked);
  const blocked = gate.status === "block";
  const line = gateLine(gate);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" aria-describedby={undefined}>
        <DialogTitle>{copyMode ? "복사해서 스레드에 달아요" : "이대로 보낼까요"}</DialogTitle>
        <DialogDescription className="mt-1">
          {copyMode ? `@${persona.handle} 은 직접 보내지 않아요. 복사한 글을 스레드에 붙여 달아 주세요.` : "보낸 뒤 5초 안에 되돌릴 수 있어요."}
        </DialogDescription>
        <div className="mt-4 space-y-2.5">
          <Preview persona={persona} to={to} message={message} image={image} gate={gate} />
          <p className={cn("px-1 text-[12px]", line.tone)}>{line.text}</p>
          {image ? null : <p className="px-1 text-[11.5px] text-neutral-500">첨부 없음</p>}
          <StageNote stage={flow.stage} />
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className={cn(btn, "text-neutral-600 hover:bg-neutral-100", press)}>
            취소
          </button>
          {copyMode ? (
            <CopyActions flow={flow} blocked={blocked} />
          ) : (
            <button type="button" onClick={onConfirmApi} disabled={blocked} className={primary}>
              <PaperAirplaneIcon className="size-3.5" />
              보내기
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
