"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowPathIcon, FolderOpenIcon } from "@heroicons/react/16/solid";
import { PageHeader } from "@/components/page-header";
import { useAccount, type AccountView } from "@/hooks/use-account";
import { usePolling } from "@/hooks/use-polling";
import { ThreadsClient } from "./replies/threads-client";
import { ThreadsLearn } from "./replies/threads-learn";
import { isLearnView, type ThreadsPlace } from "./replies/threads-place";
import { ThreadsNav } from "./replies/threads-rail";
import { AttachContext } from "./replies/threads-mark";
import { usePersona } from "./replies/use-persona";
import { useThreadsWide } from "./replies/use-wide";
import type { ThreadsSummary } from "@/lib/threads-replies/summary";
import { SetupGuide } from "./setup-guide";

function daysLeft(iso?: string): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.parse(iso) - Date.now()) / 86_400_000));
}

interface VoiceJob {
  state: "idle" | "collecting" | "pairing" | "writing" | "done" | "failed";
  replies?: number;
  pairs?: number;
  error?: string;
  starter?: boolean;
}

const VOICE_STEP: Record<string, string> = {
  collecting: "내 지난 답글을 모으는 중",
  pairing: "답글과 원댓글을 짝짓는 중",
  writing: "말투 규칙책을 쓰는 중 (1~3분)",
};

/** 말투 만들기 진행 한 줄. 끝났으면 결과와 [다시 만들기]. */
function VoiceBar() {
  const [job, setJob] = useState<VoiceJob | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/voice", { cache: "no-store" });
    if (res.ok) setJob((await res.json()) as VoiceJob);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const running = Boolean(job && VOICE_STEP[job.state]);
  usePolling(load, { label: "voice", active: running, activeMs: 3_000, idleMs: 120_000 });
  const rebuild = async () => {
    await fetch("/api/voice", { method: "POST" });
    await load();
  };
  if (!job) return null;
  let text: string;
  if (running) text = `말투 익히는 중 · ${VOICE_STEP[job.state]}${job.replies ? ` · 답글 ${job.replies}개` : ""}`;
  else if (job.state === "done")
    text = job.starter
      ? `답글이 ${job.replies ?? 0}개뿐이라 기본 말투로 시작했어요. 답글이 20개를 넘으면 다시 만들어 주세요.`
      : `내 답글 ${job.replies}개, 댓글 짝 ${job.pairs}쌍으로 말투를 익혔어요.`;
  else if (job.state === "failed") text = `말투 만들기 실패: ${job.error ?? "알 수 없는 오류"}`;
  else text = "아직 말투를 익히지 않았어요.";
  return (
    <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 pb-2 text-[12px] text-neutral-600">
      {running ? <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" /> : null}
      <span className={job.state === "failed" ? "text-rose-700" : ""}>{text}</span>
      {running ? null : (
        <button onClick={rebuild} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-emerald-700 hover:bg-emerald-50">
          <ArrowPathIcon className="size-3" />
          {job.state === "idle" ? "말투 익히기" : "다시 만들기"}
        </button>
      )}
    </div>
  );
}

function useSummary(persona: string) {
  const [summary, setSummary] = useState<ThreadsSummary | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(`/api/threads-replies/summary?persona=${encodeURIComponent(persona)}`, { cache: "no-store" });
    if (res.ok) setSummary((await res.json()) as ThreadsSummary);
  }, [persona]);
  useEffect(() => {
    void load();
  }, [load]);
  return [summary, load] as const;
}

function Workbench({ account, reload }: { account: AccountView; reload: () => Promise<void> }) {
  const [place, setPlace] = useState<ThreadsPlace>("comments");
  const { persona, current, list, switchPersona, reloadList } = usePersona("me");
  const [summary, loadSummary] = useSummary(persona);
  const wide = useThreadsWide();
  const onChanged = useCallback(() => {
    void loadSummary();
    reloadList();
  }, [loadSummary, reloadList]);
  const nav = <ThreadsNav summary={summary} place={place} go={setPlace} persona={{ current, list, onSwitch: switchPersona }} />;
  const left = daysLeft(account.expiresAt);
  const ai = account.caps?.ai;
  const aiReady = Boolean(ai?.claude || ai?.codex);

  const disconnect = async () => {
    await fetch("/api/account", { method: "DELETE" });
    await reload();
  };
  const openDocs = () => void fetch("/api/my-docs", { method: "POST" });

  return (
    <div className="min-h-screen">
      <PageHeader
        className="mx-auto max-w-6xl !px-6"
        title="스레드 답글"
        subtitle="내 글에 달린 댓글에 내 말투로 초안을 쓰고, 근거를 찾아 붙여요. 보내기는 직접 누른 것만 나가요."
        actions={
          <>
            <span className="rounded-full bg-white px-3 py-1.5 text-xs text-neutral-700 ring-1 ring-neutral-950/5">
              @{account.username ?? "연결됨"}
              {left !== null ? <span className="text-neutral-400"> · 토큰 {left}일 남음(자동 연장)</span> : null}
            </span>
            <button
              onClick={openDocs}
              title="여기 넣은 .md·.txt 파일이 답글 근거가 돼요"
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-neutral-600 ring-1 ring-neutral-950/5 hover:bg-white"
            >
              <FolderOpenIcon className="size-3.5" />내 자료 폴더
            </button>
            <button onClick={disconnect} className="rounded-full px-3 py-1.5 text-xs text-neutral-500 ring-1 ring-neutral-950/5 hover:bg-white">
              연결 해제
            </button>
          </>
        }
      />
      {aiReady ? null : (
        <p className="mx-auto max-w-6xl px-6 pb-2 text-[12px] text-amber-700">
          이 맥에 Claude Code나 Codex가 없어서 AI 초안이 꺼져 있어요. 답글은 직접 쓸 수 있어요.
        </p>
      )}
      <VoiceBar />
      <div className={`mx-auto px-6 pb-12 pt-2 ${wide ? "max-w-none" : "max-w-[1760px]"}`}>
        <AttachContext.Provider value={Boolean(account.caps?.imageAttach)}>
          {isLearnView(place) ? (
            <>
              <div className="mb-4">{nav}</div>
              <ThreadsLearn key={`${persona}-${place}`} view={place} persona={persona} />
            </>
          ) : (
            // 계정을 바꾸면 통째로 새로 그린다 — 받은함·초안·보내기 대기가 섞이지 않게.
            <ThreadsClient key={persona} view={place} onChanged={onChanged} nav={nav} />
          )}
        </AttachContext.Provider>
      </div>
    </div>
  );
}

export function Home() {
  const [account, reload] = useAccount();
  if (account === null) return null;
  if (!account.connected) return <SetupGuide onConnected={() => void reload()} />;
  return <Workbench account={account} reload={reload} />;
}
