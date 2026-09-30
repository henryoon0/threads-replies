"use client";

// 스레드 댓글 작업대 (09-29 픽: 지금 답할 5개 + 나머지 접힘 · 글별 묶음·대화 줄기 + 오른쪽 답 패널).
// 첫 로드는 GET /api/threads-replies — 초안 없는 댓글의 답 잡을 백그라운드로 깨운다.
// 이후 폴링은 ?answers=0 으로 원장만 다시 읽는다 (잡이 도는 동안만 빠르게).
// 발송은 이 파일에서 하지 않는다. 오른쪽 ThreadsAnswerPanel 이 맡는다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowPathIcon } from "@heroicons/react/16/solid";
import { usePolling } from "@/hooks/use-polling";
import { relativeTime } from "./comments-shared";
import { ThreadsAnswerPanel } from "./threads-answer-panel";
import { ThreadsBatch } from "./threads-batch";
import { ThreadsModeBar, type WorkMode } from "./threads-mode-bar";
import { useThreadsWide } from "./use-wide";
import { ThreadsList } from "./threads-list";
import { ThreadsQueueStrip } from "./threads-queue-strip";
import { ThreadsSkipAll } from "./threads-skip-all";
import { useGate, type GateChecker } from "./threads-gate";
import { ReceiptDock } from "./threads-receipt";
import { RestFold, ThreadsTopFive } from "./threads-top-five";
import {
  focusOrder,
  nextId,
  urgentReplies,
  visibleGroups,
  type UrgentItem,
  type ThreadsData,
  type ThreadsView,
  type VisibleGroup,
} from "./threads-view";

/** 지금 답하는 계정 (서버가 쿠키 reply-persona 로 가른다) */
export interface ThreadsPersona {
  id: string;
  name: string;
  handle: string;
  send: "api" | "copy";
  gate: "light" | "strict";
}

type LoadedData = ThreadsData & { job?: { status?: string } | null; persona?: ThreadsPersona };

const EMPTY: Record<ThreadsView, string> = {
  comments: "지금 답할 스레드 댓글이 없어요",
  questions: "답이 필요한 질문이 없어요",
  history: "아직 답했거나 건너뛴 댓글이 없어요",
};

const easeOut = [0.23, 1, 0.32, 1] as const;

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-40 rounded-xl bg-white ring-1 ring-neutral-950/5">
          <div className="m-3 h-3 w-2/3 rounded bg-neutral-950/[0.05]" />
          <div className="mx-3 mt-5 h-3 w-1/2 rounded bg-neutral-950/[0.04]" />
          <div className="mx-3 mt-2 h-3 w-5/6 rounded bg-neutral-950/[0.04]" />
        </div>
      ))}
    </div>
  );
}

async function fetchLedger(url: string): Promise<LoadedData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`threads-replies ${res.status}`);
  return (await res.json()) as LoadedData;
}

function useThreadsData(onChanged?: () => void) {
  const [data, setData] = useState<LoadedData | null>(null);
  const [error, setError] = useState("");
  const firstLoad = useRef(true);

  const load = useCallback(() => {
    // 첫 로드만 답 잡을 깨운다. 폴링까지 깨우면 매번 잡 파일을 건드린다.
    const url = firstLoad.current ? "/api/threads-replies" : "/api/threads-replies?answers=0";
    firstLoad.current = false;
    return fetchLedger(url).then(
      (d) => {
        setError("");
        setData(d);
      },
      (err: unknown) => {
        setError("스레드 댓글을 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
        throw err;
      }
    );
  }, []);

  useEffect(() => {
    // 실패는 load 가 error 로 남긴다
    load().catch(() => {});
  }, [load]);

  const jobRunning = data?.job?.status === "running";
  // 답 잡이 도는 동안엔 초안이 도착하는 대로 보이게 5초, 평소엔 1분 (숨은 탭에선 쉼)
  usePolling(
    async () => {
      await load();
      if (jobRunning) onChanged?.();
    },
    { label: "threads-replies", active: jobRunning, activeMs: 5_000, idleMs: 60_000 }
  );

  const reload = useCallback(() => {
    load()
      .then(() => onChanged?.())
      .catch(() => {});
  }, [load, onChanged]);

  return { data, error, reload };
}

function SyncBar({ data, onSynced }: { data: LoadedData | null; onSynced: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const sync = async () => {
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/threads-replies/sync", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = (await res.json().catch(() => ({}))) as { sync?: { lastError?: string } };
      if (!res.ok) setNotice(body.sync?.lastError ?? "새로고침에 실패했어요");
      onSynced();
    } catch {
      setNotice("새로고침에 실패했어요");
    } finally {
      setBusy(false);
    }
  };
  const last = data?.sync.lastSyncAt;
  return (
    <div className="flex items-center gap-2 text-[11px] text-neutral-500">
      <span className="min-w-0 flex-1 truncate">
        {notice ? (
          <span className="text-rose-700">{notice}</span>
        ) : last ? (
          `최근 글 ${data?.sync.postsScanned ?? 0}개 · ${relativeTime(last)} 동기화`
        ) : (
          " "
        )}
      </span>
      <button
        type="button"
        onClick={sync}
        disabled={busy}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-neutral-600 transition-[color,background-color,scale] duration-150 hover:bg-neutral-950/[0.04] hover:text-neutral-900 active:scale-[0.97] disabled:opacity-60"
      >
        <ArrowPathIcon className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
        {busy ? "가져오는 중" : "새로고침"}
      </button>
    </div>
  );
}

/** 고른 댓글. 칸을 바꾸면 그 칸의 첫 댓글부터, 고른 댓글이 목록에서 빠지면(답함·건너뜀) 옛 순서에서 그 다음 것을. */
function useSelection(order: string[], view: ThreadsView) {
  const reduce = useReducedMotion();
  const [picked, setPicked] = useState<string | null>(null);
  const [prev, setPrev] = useState({ view, order });
  if (prev.view !== view) {
    setPrev({ view, order });
    setPicked(null);
  } else if (prev.order !== order) {
    setPrev({ view, order });
    if (picked && !order.includes(picked)) setPicked(nextId(order, picked, prev.order));
  }
  const selectedId = picked && order.includes(picked) ? picked : (order[0] ?? null);

  /** 고르고 목록에서 보이게 굴린다 (질문 띠·다음 댓글) */
  /** 질문 띠에서 고르면 멀리 있을 수 있어 가운데로, 다음 댓글은 바로 아래라 최소한만 굴린다 */
  const reveal = useCallback(
    (id: string, block: ScrollLogicalPosition = "center") => {
      setPicked(id);
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-reply-id="${id.replace(/"/g, '\\"')}"]`)
          ?.scrollIntoView({ block, behavior: reduce ? "auto" : "smooth" })
      );
    },
    [reduce]
  );
  const selectNext = useCallback(() => {
    const next = nextId(order, selectedId);
    if (next) reveal(next, "nearest");
  }, [order, selectedId, reveal]);

  return { selectedId, select: setPicked, reveal, selectNext };
}

function ListPane({
  data,
  error,
  view,
  groups,
  children,
}: {
  data: LoadedData | null;
  error: string;
  view: ThreadsView;
  groups: VisibleGroup[];
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  if (!data) {
    return error ? (
      <p className="rounded-xl bg-white px-4 py-6 text-center text-xs text-rose-700 ring-1 ring-neutral-950/5">{error}</p>
    ) : (
      <ListSkeleton />
    );
  }
  return (
    <motion.div
      key={view}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.18, ease: easeOut }}
    >
      {groups.length ? (
        children
      ) : (
        <p className="rounded-xl bg-white px-4 py-10 text-center text-xs text-neutral-500 ring-1 ring-neutral-950/5">{EMPTY[view]}</p>
      )}
    </motion.div>
  );
}

function groupIndex(groups: VisibleGroup[]) {
  const m = new Map<string, string>();
  for (const g of groups) for (const t of g.threads) for (const r of [t.root, ...t.followUps]) m.set(r.id, g.post.id);
  return m;
}

/** 지금 답할 5개 + 나머지 접기. 고른 댓글이 접힌 쪽에 있으면 펴 둔다. */
function Briefing({
  urgent,
  total,
  selectedId,
  onSelect,
  gate,
  children,
}: {
  urgent: UrgentItem[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  gate: GateChecker;
  children: React.ReactNode;
}) {
  const inRest = Boolean(selectedId) && !urgent.some((u) => u.reply.id === selectedId);
  return (
    <div className="space-y-2">
      <ThreadsTopFive items={urgent} selectedId={selectedId} onSelect={onSelect} gate={gate} />
      <RestFold count={total - urgent.length} forceOpen={inRest}>
        {children}
      </RestFold>
    </div>
  );
}

/** 오른쪽 답 패널 자리. 패널이 화면보다 길어지면 패널 안에서 굴린다 (붙박이라 바깥 스크롤로는 아래가 안 보인다) */
function AnswerSide({
  selectedId,
  loaded,
  onChanged,
  onNext,
  persona,
  gate,
}: {
  selectedId: string | null;
  loaded: boolean;
  onChanged: () => void;
  onNext: () => void;
  persona: ThreadsPersona | undefined;
  gate: GateChecker;
}) {
  return (
      <div className="sticky top-5 -m-1 max-h-[calc(100dvh-2.5rem)] min-w-0 flex-1 self-start overflow-y-auto overscroll-contain p-1 pb-24">
        {selectedId ? (
          <ThreadsAnswerPanel key={selectedId} replyId={selectedId} onChanged={onChanged} onNext={onNext} persona={persona} gate={gate} />
        ) : (
          <div className="flex h-64 items-center justify-center rounded-xl bg-white text-xs text-neutral-500 ring-1 ring-neutral-950/5">
            {loaded ? "왼쪽에서 댓글을 고르면 여기서 답을 준비해요" : "\u00a0"}
          </div>
        )}
      </div>
  );
}

const FALLBACK_PERSONA: ThreadsPersona = { id: "glp1", name: "박약사", handle: "glp1.pharmacy", send: "api", gate: "strict" };

/** 하나씩 / 5개 한꺼번에 · 검색에서 고른 댓글. 지금 칸 목록에 없는 댓글(답함·건너뜀)은 목록 선택과 따로 연다. */
function useWorkMode(order: string[], select: (id: string) => void, reveal: (id: string) => void) {
  const [mode, setMode] = useState<WorkMode>("one");
  const [pinned, setPinned] = useState<string | null>(null);
  const pick = useCallback(
    (id: string) => {
      setPinned(null);
      select(id);
    },
    [select]
  );
  const pickFromSearch = useCallback(
    (id: string) => {
      setMode("one");
      setPinned(order.includes(id) ? null : id);
      if (order.includes(id)) reveal(id);
    },
    [order, reveal]
  );
  const openOne = useCallback(
    (id: string) => {
      setMode("one");
      pick(id);
    },
    [pick]
  );
  const openIdOr = (selected: string | null) => pinned ?? selected;
  return { mode, setMode, openIdOr, pick, pickFromSearch, openOne };
}

function ListColumn({
  data,
  error,
  view,
  groups,
  order,
  reload,
  children,
}: {
  data: LoadedData | null;
  error: string;
  view: ThreadsView;
  groups: VisibleGroup[];
  order: string[];
  reload: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="w-[22rem] shrink-0 space-y-2 2xl:w-[26rem]">
      <SyncBar data={data} onSynced={reload} />
      {view !== "history" && data ? <ThreadsSkipAll ids={order} onChanged={reload} /> : null}
      <ListPane data={data} error={error} view={view} groups={groups}>
        {children}
      </ListPane>
    </div>
  );
}

/** 5개 한꺼번에 · 목록을 펴나 (넓게 보기가 기본, 기록 칸은 고를 곳이 목록뿐이라 늘 편다) */
function layoutOf(mode: WorkMode, view: ThreadsView, wide: boolean) {
  const batch = mode === "batch" && view !== "history";
  const showList = !wide || view === "history";
  return { batch, showList, strip: !showList && !batch };
}

/** 기록 칸은 글별 목록 그대로, 나머지 칸은 지금 답할 5개 + 나머지 접기 */
function BriefingOrList({ view, children, ...rest }: React.ComponentProps<typeof Briefing> & { view: ThreadsView }) {
  return view === "history" ? <>{children}</> : <Briefing {...rest}>{children}</Briefing>;
}

function BatchSide({ persona, ...rest }: Omit<React.ComponentProps<typeof ThreadsBatch>, "persona"> & { persona: ThreadsPersona | undefined }) {
  return (
    <div className="min-w-0 flex-1 pb-24">
      <ThreadsBatch persona={persona ?? FALLBACK_PERSONA} {...rest} />
    </div>
  );
}

function useUrgent(data: LoadedData | null, view: ThreadsView, gate: ReturnType<typeof useGate>) {
  return useMemo(() => {
    if (!data || view === "history") return [];
    return urgentReplies(data.groups, view, (r) => Boolean(r.answer?.draft) && gate.check(r.answer!.draft).hits.length > 0);
  }, [data, view, gate]);
}

/** 앞으로 답할 몇 개(지금 답할 5개 + 다음 차례)의 버전 6벌을 서버 줄 맨 앞에 세운다 — 버전 버튼을 누르면 바로 바뀌게 */
const PREFETCH_AHEAD = 10;
function usePrefetchVariants(order: string[]) {
  const key = order.slice(0, PREFETCH_AHEAD).join("\n");
  useEffect(() => {
    if (!key) return;
    void fetch("/api/threads-replies/prefetch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: key.split("\n") }) }).catch(() => {});
  }, [key]);
}

export function ThreadsClient({
  view,
  onChanged,
  nav,
}: {
  view: ThreadsView;
  /** 위 가로 막대 왼쪽 끝 (계정 · 칸 · 학습) */
  nav?: React.ReactNode;
  /** 남은 수가 바뀌면 레일·스위치 숫자를 다시 읽게 알린다 */
  onChanged?: () => void;
}) {
  const { data, error, reload } = useThreadsData(onChanged);
  const persona = data?.persona;
  const gate = useGate(persona?.id ?? "glp1");
  const groups = useMemo(() => visibleGroups(data?.groups ?? [], view), [data, view]);
  const urgent = useUrgent(data, view, gate);
  const order = useMemo(() => {
    // 위 5개 먼저, 그다음 목록 순서 — [다음 댓글]이 보이는 순서를 따른다
    const top = urgent.map((u) => u.reply.id);
    return [...top, ...focusOrder(groups, view).filter((id) => !top.includes(id))];
  }, [urgent, groups, view]);
  usePrefetchVariants(view === "history" ? [] : order);
  const groupOf = useMemo(() => groupIndex(groups), [groups]);
  const { selectedId, select, reveal, selectNext } = useSelection(order, view);
  const wide = useThreadsWide();
  const w = useWorkMode(order, select, reveal);
  const openId = w.openIdOr(selectedId);
  const { batch, showList, strip } = layoutOf(w.mode, view, wide);
  const list = <ThreadsList groups={groups} view={view} selectedId={openId} onSelect={w.pick} groupOf={groupOf} handle={persona?.handle ?? ""} gate={gate} />;

  return (
    <div>
      <ThreadsModeBar lead={nav} mode={w.mode} onMode={w.setMode} wide={wide} onPickComment={w.pickFromSearch} batchable={view !== "history"} />
      {/* 넓게 보기(기본): 목록 대신 지금 답할 5개 가로 띠. 기록 칸은 고를 곳이 목록뿐이라 늘 편다 */}
      <ThreadsQueueStrip items={strip ? urgent : []} total={order.length} selectedId={openId} onSelect={w.pick} />
      <div className="flex items-start gap-4">
        {showList ? (
          <ListColumn data={data} error={error} view={view} groups={groups} order={order} reload={reload}>
            <BriefingOrList view={view} urgent={urgent} total={order.length} selectedId={openId} onSelect={w.pick} gate={gate}>
              {list}
            </BriefingOrList>
          </ListColumn>
        ) : null}
        {batch ? (
          <BatchSide items={urgent} persona={persona} gate={gate} onChanged={reload} onOpen={w.openOne} />
        ) : (
          <AnswerSide selectedId={openId} loaded={Boolean(data)} onChanged={reload} onNext={selectNext} persona={persona} gate={gate} />
        )}
        <ReceiptDock />
      </div>
    </div>
  );
}
