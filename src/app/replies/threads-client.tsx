"use client";

// 스레드 댓글 작업대 (09-29 픽: 지금 답할 5개 + 나머지 접힘 · 글별 묶음·대화 줄기 + 오른쪽 답 패널).
// 첫 로드는 GET /api/threads-replies — 초안 없는 댓글의 답 잡을 백그라운드로 깨운다.
// 이후 폴링은 ?answers=0 으로 원장만 다시 읽는다 (잡이 도는 동안만 빠르게).
// 발송은 이 파일에서 하지 않는다. 오른쪽 ThreadsAnswerPanel 이 맡는다.

import { useSendNotices } from "./use-send-notices";
import { toast } from "@/components/toast";
import type { ThreadsReply } from "@/lib/threads-replies/model";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { usePolling } from "@/hooks/use-polling";
import { relativeTime } from "./comments-shared";
import { ThreadsAnswerPanel } from "./threads-answer-panel";
import { ThreadsBatch } from "./threads-batch";
import { ThreadsModeBar, type SyncState, type WorkMode } from "./threads-mode-bar";
import type { MoreSection } from "./threads-more-menu";
import { ThreadsQueue, type PrepProgress } from "./threads-queue";
import { usableDraft } from "@/lib/threads-replies/usable-draft";
import { ThreadsList } from "./threads-list";
import { ThreadsSkipAll } from "./threads-skip-all";
import { useGate, type GateChecker } from "./threads-gate";
import { ReceiptDock } from "./threads-receipt";
import {
  filteredQueue,
  splitByReady,
  focusOrder,
  nextId,
  visibleGroups,
  type QueueFilter,
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

type LoadedData = ThreadsData & {
  job?: { status?: string; current?: string; working?: string[] } | null;
  /** 버전 미리 쓰기 줄 — 쓰는 중·차례 기다림 */
  variantsQueue?: { running: string[]; queued: string[] }; persona?: ThreadsPersona;
  /** 서버가 뒤에서 동기화하는 중 — 끝나면 새 댓글이 보이게 빨리 다시 읽는다 */
  syncing?: boolean };

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

  const prefetching = (data?.variantsQueue?.running.length ?? 0) + (data?.variantsQueue?.queued.length ?? 0) > 0;
  const answering = data?.job?.status === "running";
  const jobRunning = answering || prefetching || !!data?.syncing;
  // 답 잡이 도는 동안엔 초안이 도착하는 대로 보이게 5초, 미리 쓰기만 돌면 15초, 평소엔 1분 (숨은 탭에선 쉼)
  usePolling(
    async () => {
      await load();
      if (jobRunning) onChanged?.();
    },
    // 미리 쓰기·동기화가 도는 동안엔 5초마다 (10-02 henry "렉": 3초마다 목록 전체 2MB 를 받던 것을 줄였다. 버전 한 벌은 15초쯤)
    { label: "threads-replies", active: jobRunning, activeMs: 5_000, idleMs: 60_000 }
  );

  const reload = useCallback(() => {
    load()
      .then(() => onChanged?.())
      .catch(() => {});
  }, [load, onChanged]);

  return { data, error, reload, load };
}

/** 목록에 있는 댓글 id 전부 (동기화 전후를 비교해 새 댓글 수를 센다) */
function commentIds(d: LoadedData | null): Set<string> {
  return new Set((d?.groups ?? []).flatMap((g) => g.threads.flatMap((t) => [t.root.id, ...t.followUps.map((f) => f.id)])));
}

/**
 * 새로고침(동기화). 10-02 픽: 글자 줄 대신 머리줄 아이콘 하나, 동기화 시각은 풍선 글···· 메뉴로.
 * 10-02 henry "저장된 게 먼저 뜨고, 동기화될 때는 심플하게 노티": 서버가 뒤에서 동기화하는 동안(syncing) 아이콘이 돌며 "동기화 중",
 * 끝나면 알림 한 줄 — "새 댓글 3개" 또는 "최신 상태예요".
 */
function useSync(data: LoadedData | null, load: () => Promise<void>, onSynced: () => void): SyncState {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(async () => {
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/threads-replies/sync", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = (await res.json().catch(() => ({}))) as { sync?: { lastError?: string } };
      if (!res.ok) setError(body.sync?.lastError ?? "새로고침에 실패했어요");
      await load().catch(() => {});
      onSynced();
    } catch {
      setError("새로고침에 실패했어요");
    } finally {
      setRunning(false);
    }
  }, [load, onSynced]);
  const busy = running || !!data?.syncing;
  useSyncNotice(data, busy);
  const lastAt = data?.sync.lastSyncAt;
  return { busy, error, last: lastAt ? `${relativeTime(lastAt)} 동기화` : "", run: () => void run() };
}

/** 동기화가 끝나면 알림 한 줄. 시작할 때 목록을 적어 두고 끝난 뒤 목록과 비교한다. */
function useSyncNotice(data: LoadedData | null, busy: boolean) {
  const before = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (busy) {
      before.current ??= commentIds(data);
      return;
    }
    if (!before.current) return;
    const prev = before.current;
    before.current = null;
    const added = [...commentIds(data)].filter((id) => !prev.has(id)).length;
    toast.success(added ? `동기화 완료 · 새 댓글 ${added}개` : "동기화 완료 · 최신 상태예요");
  }, [busy, data]);
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

/** 왼쪽 목록. 기록 칸은 글별 목록 그대로, 나머지는 한 버튼 메뉴 목록(10-02 픽). 모두 건너뛰기는 ··· 메뉴가 연다. */
function ListColumn({
  data,
  error,
  view,
  groups,
  order,
  reload,
  skipArmed,
  onSkipClose,
  children,
}: {
  data: LoadedData | null;
  error: string;
  view: ThreadsView;
  groups: VisibleGroup[];
  order: string[];
  reload: () => void;
  skipArmed: boolean;
  onSkipClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="sticky top-5 -m-1 max-h-[calc(100dvh-2.5rem)] w-[22rem] shrink-0 space-y-2 self-start overflow-y-auto overscroll-contain p-1 pb-6 2xl:w-[26rem]">
      {view !== "history" && data ? <ThreadsSkipAll ids={order} onChanged={reload} armed={skipArmed} onClose={onSkipClose} /> : null}
      <ListPane data={data} error={error} view={view} groups={groups}>
        {children}
      </ListPane>
    </div>
  );
}

function BatchSide({ persona, ...rest }: Omit<React.ComponentProps<typeof ThreadsBatch>, "persona"> & { persona: ThreadsPersona | undefined }) {
  return (
    <div className="min-w-0 flex-1 pb-24">
      <ThreadsBatch persona={persona ?? FALLBACK_PERSONA} {...rest} />
    </div>
  );
}

/** 5개 한꺼번에: 왼쪽 목록(한 버튼 메뉴) 순서 그대로 맨 앞 5개 (10-02 — 옛 "질문 먼저" 순서와 어긋났다) */
const BATCH_N = 5;
function batchOf(queue: ThreadsReply[]): UrgentItem[] {
  return queue.slice(0, BATCH_N).map((reply) => ({ reply, reasons: reply.intent === "question" ? ["질문"] : [] }));
}

/**
 * 버전 6벌·비슷한 글을 미리 쓰는 20개 — 버전 버튼·참고 칸이 바로 뜨게.
 * 10-02 henry: "누른 댓글부터가 아니라 오래 쌓인 것 기준으로 20개". 고른 댓글·정렬·질문만과 상관없이
 * 아직 답 안 한 댓글 중 가장 오래된 20개. 답하거나 건너뛰면 목록에서 빠지고 그다음 오래된 것이 들어온다.
 */
const PREFETCH_BATCH = 20;
function oldestReplies(groups: LoadedData["groups"]): ThreadsReply[] {
  return filteredQueue(groups, { sort: "old", questionsOnly: false }).slice(0, PREFETCH_BATCH);
}
export function oldestBatch(groups: LoadedData["groups"]): string[] {
  return oldestReplies(groups).map((r) => r.id);
}
/**
 * 최근 순 [답 20개 만들기] (10-02 henry): 최근 순은 자동으로 쓰지 않는다. 누를 때마다 지금 목록 위에서부터
 * 아직 답이 없고 쓰는 중도 아닌 댓글 20개를 맡긴다. 진행은 맡긴 묶음 기준으로 "답 준비 N/20".
 */
function useManualBatch(queue: ThreadsReply[], writingIds: string[], waitingIds: string[], onQueued: () => void) {
  const [ids, setIds] = useState<string[]>([]);
  const make = useCallback(() => {
    const busy = new Set([...writingIds, ...waitingIds]);
    const next = queue.filter((r) => !usableDraft(r.answer) && !busy.has(r.id)).slice(0, PREFETCH_BATCH).map((r) => r.id);
    if (!next.length) return toast.success("위쪽 댓글은 답이 다 준비돼 있어요");
    setIds(next);
    void fetch("/api/threads-replies/prefetch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: next }) })
      .then((r) => (r.ok ? onQueued() : toast.error("답 만들기를 맡기지 못했어요")))
      .catch(() => toast.error("답 만들기를 맡기지 못했어요"));
  }, [queue, writingIds, waitingIds, onQueued]);
  const progress = useMemo(() => {
    if (!ids.length) return undefined;
    const ready = new Set(queue.filter((r) => usableDraft(r.answer)).map((r) => r.id));
    return { ready: ids.filter((id) => ready.has(id)).length, total: ids.length };
  }, [ids, queue]);
  return { make, progress };
}

function usePrefetchVariants(data: LoadedData | null, view: ThreadsView, onQueued: () => void) {
  const key = view === "history" || !data ? "" : oldestBatch(data.groups).join("\n");
  useEffect(() => {
    if (!key) return;
    // 새로 줄을 세웠으면 목록을 바로 다시 읽는다 — 안 그러면 1분 쉬는 사이 15초짜리 쓰기가 화면에 안 잡힌다 (10-02)
    void fetch("/api/threads-replies/prefetch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: key.split("\n") }) })
      .then((r) => r.json() as Promise<{ queued?: string[] }>)
      .then((b) => {
        if (b.queued?.length) onQueued();
      })
      .catch(() => {});
    // onQueued 가 바뀌어도 다시 보내지 않는다 (같은 줄을 또 세울 일은 없다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** 목록 순서(한 버튼 메뉴). 질문 칸으로 들어오면 질문만이 켜진 채로 시작한다. */
function useQueue(data: LoadedData | null, view: ThreadsView) {
  const [filter, setFilter] = useState<QueueFilter>({ sort: "old", questionsOnly: view === "questions" });
  const queue = useMemo(() => (data && view !== "history" ? filteredQueue(data.groups, filter) : []), [data, view, filter]);
  return { filter, setFilter, queue };
}

/** ··· 메뉴: 칸 이동(workbench) + 작업 방식 + 모두 건너뛰기 + 동기화 시각 */
function workMenu(menu: MoreSection[], view: ThreadsView, mode: WorkMode, setMode: (m: WorkMode) => void, armSkip: () => void, sync: SyncState): MoreSection[] {
  if (view === "history") return [...menu, { items: [], note: sync.last }];
  return [
    ...menu,
    {
      title: "보내는 방식",
      items: [
        { label: "하나씩", checked: mode === "one", onSelect: () => setMode("one") },
        { label: "5개 한꺼번에", checked: mode === "batch", onSelect: () => setMode("batch") },
      ],
    },
    { items: [{ label: "남은 댓글 모두 건너뛰기", onSelect: armSkip }], note: sync.last },
  ];
}

/** 지금 쓰는 댓글들·차례 기다리는 댓글들 — 버전 미리 쓰기 줄 기준 (답 초안 잡은 10-02 에 껐다) */
const NO_QUEUE = { running: [] as string[], queued: [] as string[] };
function progressOf(data: LoadedData | null): { writingIds: string[]; waitingIds: string[] } {
  const q = data?.variantsQueue ?? NO_QUEUE;
  return { writingIds: q.running, waitingIds: q.queued };
}

/** 받은 데이터에서 화면이 자주 쓰는 값 (없으면 AICC 기본) */
function loadedBits(data: LoadedData | null) {
  const persona = data?.persona;
  return { persona, personaId: persona?.id ?? "glp1", handle: persona?.handle ?? "", ...progressOf(data) };
}

/** 기록 칸은 글별 목록, 나머지는 한 버튼 메뉴 목록 */
function ListBody({
  progress,
  onMakeBatch,
  view,
  groups,
  groupOf,
  handle,
  queue,
  filter,
  onFilter,
  openId,
  onSelect,
  gate,
  writingIds,
  waitingIds,
}: {
  view: ThreadsView;
  groups: VisibleGroup[];
  groupOf: Map<string, string>;
  handle: string;
  queue: ThreadsReply[];
  progress?: PrepProgress;
  onMakeBatch?: () => void;
  filter: QueueFilter;
  onFilter: (f: QueueFilter) => void;
  openId: string | null;
  onSelect: (id: string) => void;
  gate: GateChecker;
  writingIds: string[];
  waitingIds: string[];
}) {
  if (view === "history") return <ThreadsList groups={groups} view={view} selectedId={openId} onSelect={onSelect} groupOf={groupOf} handle={handle} gate={gate} />;
  return <ThreadsQueue items={queue} progress={progress} onMakeBatch={onMakeBatch} filter={filter} onFilter={onFilter} selectedId={openId} onSelect={onSelect} gate={gate} writingIds={writingIds} waitingIds={waitingIds} />;
}

const NO_IDS: ReadonlySet<string> = new Set();

export function ThreadsClient({
  view,
  onChanged,
  nav,
  menu = [],
}: {
  view: ThreadsView;
  /** 위 가로 막대 왼쪽 끝 (계정 · 남은 수) */
  nav?: React.ReactNode;
  /** ··· 메뉴의 칸 이동 섹션(학습·기록) — workbench 가 넘긴다 */
  menu?: MoreSection[];
  /** 남은 수가 바뀌면 레일·스위치 숫자를 다시 읽게 알린다 */
  onChanged?: () => void;
}) {
  const { data, error, reload, load } = useThreadsData(onChanged);
  // 다른 댓글로 옮긴 뒤 끝난 보내기도 알리고 목록을 다시 읽는다
  useSendNotices(reload);
  const { persona, personaId, handle, writingIds, waitingIds } = loadedBits(data);
  const gate = useGate(personaId);
  const groups = useMemo(() => visibleGroups(data?.groups ?? [], view), [data, view]);
  const { filter, setFilter, queue: filtered } = useQueue(data, view);
  // 준비된 답부터 (10-02): 위 칸 = 답 있음, 아래 칸 = 준비 중. "다음 댓글"도 이 순서
  // 10-02 henry "답이 생길 때마다 화면이 바뀌어 불편"으로 칸 나누기를 뺐다가, 같은 날 "초록 점이 중간에 띄어지면 안 돼"로 되살렸다.
  // 다시 쓰는 중이어도 이미 답이 있으면 위 칸에 둔다 (줄이 아래로 튀지 않게).
  const queue = useMemo(() => {
    const { ready, preparing } = splitByReady(filtered, NO_IDS);
    return [...ready, ...preparing];
  }, [filtered]);
  const order = useMemo(() => (view === "history" ? focusOrder(groups, view) : queue.map((r) => r.id)), [view, groups, queue]);
  const groupOf = useMemo(() => groupIndex(groups), [groups]);
  const { selectedId, select, reveal, selectNext } = useSelection(order, view);
  usePrefetchVariants(data, view, reload);
  const manual = useManualBatch(queue, writingIds, waitingIds, reload);
  // 진행 숫자는 최근 순 [답 20개 만들기] 묶음만 (오래된 순 20개는 알아서 준비된다, 10-02 henry)
  const progress = filter.sort === "new" ? manual.progress : undefined;
  const w = useWorkMode(order, select, reveal);
  const openId = w.openIdOr(selectedId);
  const batch = w.mode === "batch" && view !== "history";
  const sync = useSync(data, load, reload);
  const [skipArmed, setSkipArmed] = useState(false);

  return (
    <div>
      <ThreadsModeBar lead={nav} onPickComment={w.pickFromSearch} sync={sync} menu={workMenu(menu, view, w.mode, w.setMode, () => setSkipArmed(true), sync)} />
      <div className="flex items-start gap-4">
        <ListColumn data={data} error={error} view={view} groups={groups} order={order} reload={reload} skipArmed={skipArmed} onSkipClose={() => setSkipArmed(false)}>
          <ListBody progress={progress} onMakeBatch={filter.sort === "new" ? manual.make : undefined} view={view} groups={groups} groupOf={groupOf} handle={handle} queue={queue} filter={filter} onFilter={setFilter} openId={openId} onSelect={w.pick} gate={gate} writingIds={writingIds} waitingIds={waitingIds} />
        </ListColumn>
        {batch ? (
          <BatchSide items={batchOf(queue)} persona={persona} gate={gate} onChanged={reload} onOpen={w.openOne} />
        ) : (
          <AnswerSide selectedId={openId} loaded={Boolean(data)} onChanged={reload} onNext={selectNext} persona={persona} gate={gate} />
        )}
        <ReceiptDock />
      </div>
    </div>
  );
}
