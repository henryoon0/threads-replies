"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowPathIcon } from "@heroicons/react/16/solid";
import { PageHeader } from "@/components/page-header";
import { useAccount, type AccountView } from "@/hooks/use-account";
import { usePolling } from "@/hooks/use-polling";
import { ThreadsClient } from "./replies/threads-client";
import { ThreadsLearn } from "./replies/threads-learn";
import { isLearnView, type ThreadsPlace } from "./replies/threads-place";
import { ThreadsNav, threadsPlaceMenu } from "./replies/threads-rail";
import { ChannelSwitch } from "./replies/channel-switch";
import { ThreadsMoreMenu, type MoreSection } from "./replies/threads-more-menu";
import { AttachContext } from "./replies/threads-mark";
import { usePersona } from "./replies/use-persona";
import type { ThreadsSummary } from "@/lib/threads-replies/summary";
import { TokenModal } from "./token-modal";

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
  /** 팩 규칙책이 있어 말투 만들기가 필요 없다 */
  pack?: boolean;
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
  // 다 익혔으면 줄을 숨긴다 (다시 만들기는 ··· 메뉴). 익히는 중·실패·아직일 때만 보인다.
  if (!job || job.pack || (job.state === "done" && !job.starter)) return null;
  let text: string;
  if (running) text = `말투 익히는 중 · ${VOICE_STEP[job.state]}${job.replies ? ` · 답글 ${job.replies}개` : ""}`;
  else if (job.state === "done")
    text = job.starter
      ? `답글이 ${job.replies ?? 0}개뿐이라 기본 말투로 시작했어요. 답글이 20개를 넘으면 다시 만들어 주세요.`
      : `내 답글 ${job.replies}개, 댓글 짝 ${job.pairs}쌍으로 말투를 익혔어요.`;
  else if (job.state === "failed") text = `말투 만들기 실패: ${job.error ?? "알 수 없는 오류"}`;
  else text = "아직 말투를 익히지 않았어요.";
  return (
    <div className="mx-auto flex max-w-[1760px] items-center gap-2 px-6 pt-3 text-[12px] text-neutral-600">
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

/** 계정 묶음: 답하는 데 매번 쓰지 않는 것이라 ··· 메뉴에 둔다. */
function accountSection(account: AccountView, ask: () => void, disconnect: () => void): MoreSection {
  const left = daysLeft(account.expiresAt);
  const openDocs = () => void fetch("/api/my-docs", { method: "POST" });
  const items = account.connected
    ? [
        { label: "내 자료 폴더 열기", onSelect: openDocs },
        { label: "연결 해제", onSelect: disconnect },
      ]
    : [
        { label: "토큰 넣기", onSelect: ask },
        { label: "내 자료 폴더 열기", onSelect: openDocs },
      ];
  const note = account.connected ? `@${account.username ?? "연결됨"}${left !== null ? ` · 토큰 ${left}일 남음(자동 연장)` : ""}` : "아직 연결 안 됨";
  return { title: "계정", items, note };
}

function Workbench({ account, reload }: { account: AccountView; reload: () => Promise<void> }) {
  const [place, setPlace] = useState<ThreadsPlace>("comments");
  // 토큰이 없어도 화면은 그대로 보여주고, 처음 들어오면 토큰 팝업을 띄운다.
  // 이 컴퓨터에 이미 연결한 토큰이 있으면 서버(GET /api/account)가 먼저 붙여서 팝업이 뜨지 않는다.
  const [ask, setAsk] = useState(!account.connected);
  const { persona, current, list, switchPersona, reloadList } = usePersona("glp1");
  const [summary, loadSummary] = useSummary(persona);
  const onChanged = useCallback(() => {
    void loadSummary();
    reloadList();
  }, [loadSummary, reloadList]);
  const nav = <ThreadsNav summary={summary} place={place} go={setPlace} persona={{ current, list, onSwitch: switchPersona }} />;
  const ai = account.caps?.ai;
  const aiState = ai?.state ?? (ai?.claude || ai?.codex ? "ready" : "missing");

  const disconnect = async () => {
    await fetch("/api/account", { method: "DELETE" });
    await reload();
  };
  const menu = [...threadsPlaceMenu(place, setPlace, summary), accountSection(account, () => setAsk(true), () => void disconnect())];

  return (
    <div className="min-h-screen">
      {ask && !account.connected ? (
        <TokenModal
          tried={account.found?.state === "none" ? account.found.tried : 0}
          onClose={() => setAsk(false)}
          onConnected={() => {
            setAsk(false);
            void reload();
          }}
        />
      ) : null}
      <PageHeader
        title="소통"
        subtitle="스레드 글에 달린 댓글에 답해요. 스레드는 댓글만 있어요."
        actions={<ChannelSwitch value="threads" onChange={() => {}} counts={{ threads: summary?.pending }} />}
      />
      {aiState === "ready" ? null : (
        <p className="mx-auto max-w-[1760px] px-6 pt-3 text-[12px] text-amber-700">
          {aiState === "logged-out"
            ? "Claude Code(또는 Codex)가 로그인돼 있지 않아서 AI 초안이 꺼져 있어요. 터미널에 claude auth login 을 입력해 로그인한 뒤 새로고침해 주세요."
            : "이 맥에 Claude Code나 Codex가 없어서 AI 초안이 꺼져 있어요. 답글은 직접 쓸 수 있어요."}
        </p>
      )}
      <VoiceBar />
      <div className="mx-auto flex max-w-[1760px] gap-6 px-6 pt-5">
        <div className="min-w-0 flex-1 pb-6">
          <AttachContext.Provider value={Boolean(account.caps?.imageAttach)}>
            {isLearnView(place) ? (
              <>
                <div className="mb-4 flex items-center gap-2">
                  {nav}
                  <span className="ml-auto" />
                  <ThreadsMoreMenu sections={menu} />
                </div>
                <ThreadsLearn key={`${persona}-${place}`} view={place} persona={persona} />
              </>
            ) : (
              // 계정을 바꾸면 통째로 새로 그린다 — 받은함·초안·보내기 대기가 섞이지 않게.
              <ThreadsClient key={persona} view={place} onChanged={onChanged} nav={nav} menu={menu} />
            )}
          </AttachContext.Provider>
        </div>
      </div>
    </div>
  );
}

export function Home() {
  const [account, reload] = useAccount();
  if (account === null) return null;
  return <Workbench account={account} reload={reload} />;
}
