"use client";

// 학습 · 성과 — 픽 18 "숫자 줄". 이번 주 보낸 답, 그대로 보낸 비율, 평균 수정량, 관문이 막은 답.
// 과거 답 다시 돌리기(replay)는 보낸 수에 안 센다. 없으면 없다고 말한다(지어낸 숫자 금지).
// 주 단위 숫자가 이번 주·지난주 2개뿐이라 작은 추이 그래프는 아직 안 그린다.
import NumberFlow from "@number-flow/react";
import { pct, useLearnJson, type LearningOverview } from "./learn-data";
import { LearnError, LearnHeader, LearnLoading, TokenGauge } from "./learn-parts";

type Week = LearningOverview["stats"]["thisWeek"];

interface Stat {
  label: string;
  value: number | null;
  suffix?: string;
  last: number | null;
  hint: string;
}

export function progressStats(now: Week, last: Week): Stat[] {
  return [
    { label: "보낸 답", value: now.sent, last: last.sent, hint: "이번 주 실제로 보낸 답" },
    { label: "그대로 보낸 비율", value: pct(now.asIsRatio), suffix: "%", last: pct(last.asIsRatio), hint: "AI 초안을 고치지 않고 보낸 비율" },
    { label: "평균 수정량", value: pct(now.avgEditRatio), suffix: "%", last: pct(last.avgEditRatio), hint: "초안에서 바꾼 글자 비율 평균" },
    { label: "관문이 막은 답", value: now.gateBlocks, last: last.gateBlocks, hint: "안전 관문이 보내기 전에 멈춘 답" },
  ];
}

export function LearnProgress({ persona }: { persona: string }) {
  const { data, error, reload } = useLearnJson<LearningOverview>("/api/personas/learning");
  if (!data) return error ? <LearnError message={error} onRetry={reload} /> : <LearnLoading />;
  const { thisWeek, lastWeek, replayed, learnable } = data.stats;
  const empty = thisWeek.sent === 0 && lastWeek.sent === 0;

  return (
    <div className="mx-auto max-w-[760px] space-y-5" data-persona={persona}>
      <LearnHeader title="성과" sub={<span className="tabular-nums">{thisWeek.weekStart} 주 · 지난주와 비교</span>} />
      <dl className="grid grid-cols-2 overflow-hidden rounded-2xl bg-white ring-1 ring-neutral-950/5 md:grid-cols-4">
        {progressStats(thisWeek, lastWeek).map((s, i) => (
          <StatCell key={s.label} s={s} first={i === 0} />
        ))}
      </dl>
      {empty ? (
        <p className="rounded-xl bg-neutral-950/[0.03] px-4 py-3 text-[13px] leading-relaxed text-neutral-600">
          아직 보낸 답이 없어요. 답을 보내기 시작하면 이 숫자들이 채워져요.
          {replayed ? <span className="text-neutral-500"> 지금 학습은 과거 답 {replayed}개를 다시 돌린 기록으로 하고 있어요. 이건 보낸 수에 넣지 않았어요.</span> : null}
        </p>
      ) : null}
      <div className="grid gap-4 rounded-2xl bg-white p-5 ring-1 ring-neutral-950/5 sm:grid-cols-2">
        <div>
          <p className="text-[11.5px] text-neutral-500">학습 재료</p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-neutral-900">
            <NumberFlow value={learnable} />
            <span className="ml-1 text-[13px] font-normal text-neutral-500">개</span>
          </p>
          <p className="mt-0.5 text-[12px] text-neutral-400">AI 초안과 보낸 답이 둘 다 있는 기록</p>
        </div>
        <TokenGauge className="self-center" used={data.stats.rulebook.tokens} cap={data.stats.rulebook.budget} />
      </div>
    </div>
  );
}

export function diffLabel(s: Pick<Stat, "value" | "last" | "suffix">): string {
  const unit = s.suffix ?? "";
  if (s.last === null) return "지난주 기록 없음";
  if (s.value === null || s.value === s.last) return `지난주 ${s.last}${unit}`;
  const diff = s.value - s.last;
  return `지난주보다 ${diff > 0 ? "+" : ""}${diff}${unit}`;
}

function StatCell({ s, first }: { s: Stat; first: boolean }) {
  return (
    <div className={first ? "p-5" : "p-5 shadow-[-1px_0_0_0_rgba(10,10,10,0.05)]"} title={s.hint}>
      <dt className="text-[11.5px] text-neutral-500">{s.label}</dt>
      <dd className="mt-1.5 text-[26px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-neutral-900">
        {s.value === null ? <span className="text-neutral-300">없음</span> : <NumberFlow value={s.value} suffix={s.suffix} />}
      </dd>
      <dd className="mt-2 text-[11.5px] tabular-nums text-neutral-400">
        {diffLabel(s)}
      </dd>
    </div>
  );
}
