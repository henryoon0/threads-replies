"use client";

// 주제 입장 카드 (시안 픽 12 pc-stance). "이 주제에 내가 해 온 말" 한 장:
// 주제 · 1~2문장 요약([n]은 아래 원 답 번호) · 번호 붙은 원 답(날짜·링크).
// GET /api/threads-replies/[id]/stance — 처음엔 10초쯤 걸리고 그 뒤로는 서버가 기억한다.

import { Fragment, useCallback, useEffect, useState } from "react";
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, ChatBubbleBottomCenterTextIcon } from "@heroicons/react/16/solid";
import { cn } from "@/lib/utils";
import { press } from "./threads-answer-verdict";

export interface StanceItem {
  n: number;
  text: string;
  date?: string;
  permalink?: string;
}

export interface Stance {
  topic: string;
  summary: string;
  items: StanceItem[];
}

type State = { status: "loading" } | { status: "done"; stance: Stance } | { status: "failed"; error: string };

// 패널은 댓글마다 새로 그려진다 — 이미 받은 카드는 다시 부르지 않는다
const memo = new Map<string, Stance>();

function useStance(replyId: string) {
  const [state, setState] = useState<State>(() => {
    const known = memo.get(replyId);
    return known ? { status: "done", stance: known } : { status: "loading" };
  });
  const load = useCallback(() => {
    let alive = true;
    fetch(`/api/threads-replies/${encodeURIComponent(replyId)}/stance`, { cache: "no-store" })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as Stance & { error?: string };
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        if (!Array.isArray(body.items)) throw new Error("입장 카드 모양이 달라요");
        return body;
      })
      .then(
        (stance) => {
          memo.set(replyId, stance);
          if (alive) setState({ status: "done", stance });
        },
        (e: unknown) => {
          if (alive) setState({ status: "failed", error: e instanceof Error ? e.message : String(e) });
        }
      );
    return () => {
      alive = false;
    };
  }, [replyId]);
  useEffect(() => {
    if (memo.has(replyId)) return;
    return load();
  }, [replyId, load]);
  const retry = () => {
    setState({ status: "loading" });
    load();
  };
  return { state, retry };
}

/** 요약 속 [n] 을 작은 번호 표시로 */
function SummaryText({ text }: { text: string }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\[(\d+)\]$/.exec(p);
        return m ? (
          <sup key={i} className="mx-px rounded bg-emerald-50 px-1 text-[10px] font-semibold tabular-nums text-emerald-700">
            {m[1]}
          </sup>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        );
      })}
    </>
  );
}

function shortDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getFullYear() % 100}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function Head({ topic }: { topic?: string }) {
  return (
    <p className="flex items-center gap-1.5 px-1 text-[12px] font-semibold text-neutral-800">
      <ChatBubbleBottomCenterTextIcon className="size-4 text-neutral-400" aria-hidden />
      이 주제에 내가 해 온 말
      {topic ? <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] font-medium text-neutral-600">{topic}</span> : null}
    </p>
  );
}

export function ThreadsStanceCard({ replyId }: { replyId: string }) {
  const { state, retry } = useStance(replyId);
  return (
    <section aria-label="이 주제에 내가 해 온 말" className="rounded-[18px] bg-white p-3 ring-1 ring-neutral-950/5">
      {state.status === "loading" ? (
        <div aria-busy="true">
          <Head />
          <p className="mt-2 px-1 text-[11.5px] text-neutral-500">지난 답과 글에서 찾는 중이에요 · 처음엔 10초쯤 걸려요</p>
          <div className="mt-2 space-y-1.5 px-1">
            <div className="h-3 w-5/6 animate-pulse rounded bg-neutral-100" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-100" />
          </div>
        </div>
      ) : state.status === "failed" ? (
        <div className="flex items-center gap-2">
          <Head />
          <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-500">{state.error}</span>
          <button type="button" onClick={retry} className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50", press)}>
            <ArrowPathIcon className="size-3" />
            다시 찾기
          </button>
        </div>
      ) : (
        <>
          <Head topic={state.stance.topic} />
          {state.stance.items.length === 0 ? (
            <p className="mt-2 px-1 text-[12px] text-neutral-500">이 주제로 전에 한 말이 없어요</p>
          ) : (
            <>
              <p className="mt-2 px-1 text-[13px] leading-[1.65] text-neutral-800 break-keep">
                <SummaryText text={state.stance.summary} />
              </p>
              <ol className="mt-2.5 space-y-0.5">
                {state.stance.items.map((it) => (
                  <li key={it.n} className="flex gap-2 rounded-[10px] px-1 py-1.5">
                    <span className="mt-px inline-flex size-4 shrink-0 items-center justify-center rounded bg-emerald-50 text-[10px] font-semibold tabular-nums text-emerald-700">
                      {it.n}
                    </span>
                    <p className="line-clamp-2 min-w-0 flex-1 text-[12px] leading-relaxed text-neutral-600 break-keep">{it.text}</p>
                    <span className="shrink-0 text-[10.5px] tabular-nums text-neutral-400">{shortDate(it.date)}</span>
                    {it.permalink ? (
                      <a href={it.permalink} target="_blank" rel="noreferrer" aria-label="원 답 열기" className="shrink-0 text-neutral-400 hover:text-emerald-700">
                        <ArrowTopRightOnSquareIcon className="size-3.5" />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}
