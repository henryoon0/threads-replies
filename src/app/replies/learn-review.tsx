"use client";

// 학습 · 주간 검토 — 픽 16 "한 장씩 판결". 주인 패턴 분석이 먼저, 규칙 변경은 그다음, 적용(A)·거절(R).
// 안전 잠금 카드는 이유만 보여 주고 적용을 막는다. 적용하면 커밋 줄과 되돌리기가 남는다.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUturnLeftIcon, CheckIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { failReason, isDecided, isLockedCard, pendingDeck, postJson, cardTitle, useLearnJson, type LearningOverview, type ReviewCard } from "./learn-data";
import { btnPrimary, btnQuiet, Kbd, LearnError, LearnHeader, LearnLoading, TokenGauge } from "./learn-parts";
import { ReviewCardBody } from "./learn-review-card";
import { RunJobButton } from "./learn-run-job";

type Verdict = "apply" | "reject";

function patchCard(data: LearningOverview, id: string, patch: Partial<ReviewCard>): LearningOverview {
  return { ...data, cards: data.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

/** 한 장 판결을 서버에 보낸다. 패턴 카드 적용 = 규칙 더하기, 패턴 카드 거절 = 이번 화면에서만 넘기기. */
async function sendVerdict(card: ReviewCard, v: Verdict): Promise<{ patch?: Partial<ReviewCard>; skip?: boolean; error?: string }> {
  if (card.type === "pattern" && v === "reject") return { skip: true };
  const res =
    card.type === "proposal"
      ? await postJson<{ status: string; commit?: string }>(`/api/personas/learning/proposals/${encodeURIComponent(card.id)}`, { action: v })
      : await postJson<{ status: string; commit?: string }>("/api/personas/learning/rules", { id: card.id, action: "add" });
  if (res.status === 409 && res.body.status === "locked") return { patch: { status: "locked", safety: { locked: true, reason: failReason(res) } } };
  if (!res.ok) return { error: failReason(res) };
  return { patch: { status: v === "apply" ? "applied" : "rejected", commit: res.body.commit } };
}

function useVerdictKeys(onKey: (v: Verdict) => void) {
  const ref = useRef(onKey);
  useEffect(() => {
    ref.current = onKey;
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k !== "a" && k !== "r") return;
      e.stopPropagation();
      e.preventDefault();
      ref.current(k === "a" ? "apply" : "reject");
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);
}

/** 한 장 판결 상태: 넘긴 카드, 보내는 중, 알림, 넘기는 방향 */
function useVerdict(data: LearningOverview | null, setData: (fn: (d: LearningOverview | null) => LearningOverview | null) => void) {
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dir, setDir] = useState(1);
  const deck = data ? pendingDeck(data.cards, skipped) : [];
  const cur = deck[0] ?? null;
  const skip = (id: string) => setSkipped((s) => new Set(s).add(id));

  const send = async (card: ReviewCard, v: Verdict) => {
    setBusy(true);
    try {
      const r = await sendVerdict(card, v);
      setNotice(r.error ?? null);
      if (r.skip) skip(card.id);
      if (r.patch) setData((d) => (d ? patchCard(d, card.id, r.patch!) : d));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const decide = (v: Verdict) => {
    if (!cur || busy) return;
    setNotice(null);
    setDir(v === "apply" ? 1 : -1);
    if (isLockedCard(cur)) {
      if (v === "reject") skip(cur.id);
      return;
    }
    if (v === "apply" && cur.type === "pattern" && !cur.canAddRule) return;
    void send(cur, v);
  };
  useVerdictKeys(decide);
  return { deck, cur, busy, notice, dir, decide };
}

export function LearnReview({ persona }: { persona: string }) {
  const { data, setData, error, reload } = useLearnJson<LearningOverview>("/api/personas/learning");
  const v = useVerdict(data, setData);
  if (!data) return error ? <LearnError message={error} onRetry={reload} /> : <LearnLoading />;
  const decided = data.cards.filter(isDecided);
  const delta = v.cur?.proposal?.deltaTokens ?? 0;

  return (
    <div className="mx-auto max-w-[720px] space-y-5" data-persona={persona}>
      <LearnHeader
        title="주간 검토"
        sub={<ReviewSub total={data.cards.length} left={v.deck.length} />}
        right={<RunJobButton job={data.job} lastRunAt={data.lastRunAt} onTick={reload} />}
      />
      <TokenGauge used={data.budget.tokens} cap={data.budget.cap} next={delta > 0 ? data.budget.tokens + delta : undefined} />
      {error ? <LearnError message={error} onRetry={reload} /> : null}
      {data.patternsError ? <LearnError message={`패턴 분석이 일부 실패했어요: ${data.patternsError}`} /> : null}
      <Deck cur={v.cur} rest={v.deck.slice(1)} dir={v.dir} busy={v.busy} notice={v.notice} decide={v.decide} empty={data.cards.length === 0} />
      {decided.length ? <DecidedList cards={decided} onReverted={reload} /> : null}
    </div>
  );
}

function ReviewSub({ total, left }: { total: number; left: number }) {
  if (!total) return <>아직 분석한 카드가 없어요</>;
  return (
    <span className="tabular-nums">
      카드 {total}장 · 남은 판결 {left}장
    </span>
  );
}

interface DeckProps {
  cur: ReviewCard | null;
  rest: ReviewCard[];
  dir: number;
  busy: boolean;
  notice: string | null;
  decide: (v: Verdict) => void;
  empty: boolean;
}

function Deck({ cur, rest, dir, busy, notice, decide, empty }: DeckProps) {
  const reduce = Boolean(useReducedMotion());
  const enter = reduce ? { opacity: 0 } : { opacity: 0, y: 10 };
  return (
    <div>
      <div className="relative">
        <DeckPeek count={cur ? rest.length : 0} />
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          {cur ? (
            <motion.article
              key={cur.id}
              initial={enter}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir * 40, transition: { duration: 0.14 } }}
              transition={spring.moderate}
              className={cn("relative rounded-[20px] p-6 ring-1 ring-neutral-950/5", isLockedCard(cur) ? "bg-neutral-50" : "bg-white shadow-[0_1px_2px_rgba(10,10,10,0.04),0_12px_32px_-16px_rgba(10,10,10,0.18)]")}
            >
              <ReviewCardBody card={cur} />
              {notice ? <p role="alert" className="mt-4 text-right text-[12px] text-amber-700">{notice}</p> : null}
              <VerdictBar card={cur} busy={busy} decide={decide} />
            </motion.article>
          ) : (
            <motion.div key="done" initial={enter} animate={{ opacity: 1, y: 0 }} transition={spring.moderate} className="rounded-[20px] bg-white p-6 ring-1 ring-neutral-950/5">
              <DoneNote empty={empty} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {cur ? <NextLine rest={rest} /> : null}
    </div>
  );
}

function DeckPeek({ count }: { count: number }) {
  return (
    <>
      {count >= 1 ? <div aria-hidden className="absolute inset-x-5 -bottom-2.5 top-2.5 rounded-[20px] bg-white/70 ring-1 ring-neutral-950/5" /> : null}
      {count >= 2 ? <div aria-hidden className="absolute inset-x-10 -bottom-5 top-5 rounded-[20px] bg-white/45 ring-1 ring-neutral-950/5" /> : null}
    </>
  );
}

function DoneNote({ empty }: { empty: boolean }) {
  return (
    <>
      <p className="text-[12px] font-medium text-emerald-700">{empty ? "검토할 카드 없음" : "이번 주 검토 끝"}</p>
      <p className="mt-1 text-[15px] text-neutral-700">{empty ? "이번 주 분석을 돌리면 카드가 여기에 쌓여요." : "판결한 카드는 아래에 남아 있어요."}</p>
    </>
  );
}

function NextLine({ rest }: { rest: ReviewCard[] }) {
  if (!rest.length) return null;
  return (
    <p className="mt-8 flex items-center gap-2 px-1 text-[12px] text-neutral-400">
      다음
      <span className="min-w-0 truncate text-neutral-600">{cardTitle(rest[0])}</span>
      {rest.length > 1 ? <span className="shrink-0 tabular-nums">외 {rest.length - 1}장</span> : null}
    </p>
  );
}

// 카드가 길어도 판결 버튼이 화면 아래에 붙어 있게 (카드 안에서만 붙는다)
const STICKY_BAR =
  "sticky bottom-0 z-10 -mx-6 -mb-6 mt-6 flex items-center rounded-b-[20px] bg-white/85 px-6 py-4 shadow-[0_-1px_0_0_rgba(10,10,10,0.05)] backdrop-blur-md";

function VerdictBar({ card, busy, decide }: { card: ReviewCard; busy: boolean; decide: (v: Verdict) => void }) {
  if (isLockedCard(card)) {
    return (
      <div className={STICKY_BAR}>
        <button type="button" onClick={() => decide("reject")} className={cn(btnPrimary, "bg-neutral-900 hover:bg-neutral-800")}>
          확인하고 넘기기 <Kbd>R</Kbd>
        </button>
      </div>
    );
  }
  const cantAdd = card.type === "pattern" && !card.canAddRule;
  // 버튼은 앞쪽(왼쪽)에 둔다 — 오른쪽 아래는 전역 떠 있는 알림이 가린다
  return (
    <div className={cn(STICKY_BAR, "gap-2")}>
      <button type="button" disabled={busy || cantAdd} onClick={() => decide("apply")} className={btnPrimary}>
        <CheckIcon className="size-4" aria-hidden />
        {card.type === "pattern" ? "규칙으로 더하기" : "적용"}
        <Kbd>A</Kbd>
      </button>
      <button type="button" disabled={busy} onClick={() => decide("reject")} className={btnQuiet}>
        <XMarkIcon className="size-4" aria-hidden />
        {card.type === "pattern" ? "넘기기" : "거절"}
        <Kbd className="bg-neutral-950/[0.06] text-neutral-500">R</Kbd>
      </button>
      {cantAdd ? <span className="ml-1 text-[12px] text-neutral-400">근거가 3건보다 적어서 아직 규칙으로 못 더해요</span> : null}
    </div>
  );
}

function DecidedList({ cards, onReverted }: { cards: ReviewCard[]; onReverted: () => void }) {
  return (
    <section className="pt-4">
      <h3 className="px-1 text-[12px] font-medium text-neutral-500">판결한 카드</h3>
      <ul className="mt-2 space-y-1">
        {cards.map((c) => (
          <CommitLine key={c.id} card={c} onReverted={onReverted} />
        ))}
      </ul>
    </section>
  );
}

function CommitLine({ card, onReverted }: { card: ReviewCard; onReverted: () => void }) {
  const [state, setState] = useState<"idle" | "busy" | string>("idle");
  const applied = card.status === "applied";
  const revert = async () => {
    if (!card.commit) return;
    setState("busy");
    const r = await postJson("/api/personas/learning/revert", { commit: card.commit });
    if (r.ok) onReverted();
    setState(r.ok ? "idle" : failReason(r));
  };
  return (
    <li className="flex min-h-10 items-center gap-2 rounded-xl bg-white py-1 pl-3 pr-1 text-[12.5px] ring-1 ring-neutral-950/5">
      <span className={cn("size-1.5 shrink-0 rounded-full", applied ? "bg-emerald-500" : "bg-neutral-300")} aria-hidden />
      <span className={cn("shrink-0 font-medium", applied ? "text-emerald-700" : "text-neutral-500")}>{applied ? "적용" : "거절"}</span>
      <span className="min-w-0 flex-1 truncate text-neutral-700">{cardTitle(card)}</span>
      {state !== "idle" && state !== "busy" ? <span className="shrink-0 text-[11.5px] text-amber-700">{state}</span> : null}
      {applied && card.commit ? (
        <>
          <code className="shrink-0 font-mono text-[11px] text-neutral-400">{card.commit.slice(0, 7)}</code>
          <button type="button" disabled={state === "busy"} onClick={revert} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-neutral-600 hover:bg-neutral-950/[0.05] disabled:opacity-50">
            <ArrowUturnLeftIcon className="size-3.5" aria-hidden />
            되돌리기
          </button>
        </>
      ) : null}
    </li>
  );
}
