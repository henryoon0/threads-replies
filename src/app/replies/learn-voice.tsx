"use client";

// 학습 · 말투 재료 — 픽 4 "제외 심사 먼저". 배우면 안 되는 표현이 걸린 과거 답을 표로 먼저 본다.
// 걸린 문구는 배경을 칠하고, 이유는 마우스를 올리면 보인다(빨간 배지 금지). 줄마다 제외·유지·가리기.
// 박약사 처방약 선택·용량 답은 잠겨 있어 제외만 된다.
import { useState } from "react";
import { LockClosedIcon } from "@heroicons/react/16/solid";
import NumberFlow from "@number-flow/react";
import { cn } from "@/lib/utils";
import { failReason, phraseSegments, postJson, remainingMaterial, restat, useLearnJson, type ExclusionDecision, type VoiceCandidate, type VoiceData } from "./learn-data";
import { LearnError, LearnHeader, LearnLoading } from "./learn-parts";

const OPTIONS: { value: ExclusionDecision; label: string; hint: string }[] = [
  { value: "exclude", label: "제외", hint: "이 답은 말투 재료에서 뺀다" },
  { value: "keep", label: "유지", hint: "그대로 배운다" },
  { value: "mask", label: "가리기", hint: "걸린 문구만 가리고 배운다" },
];

export function LearnVoice({ persona }: { persona: string }) {
  const { data, setData, error, reload } = useLearnJson<VoiceData>("/api/personas/voice");
  const [rowError, setRowError] = useState<Record<string, string>>({});

  if (!data) return error ? <LearnError message={error} onRetry={reload} /> : <LearnLoading />;

  const decide = async (c: VoiceCandidate, decision: ExclusionDecision) => {
    if (c.locked || c.decision === decision) return;
    const apply = (d: ExclusionDecision) =>
      setData((prev) => {
        if (!prev) return prev;
        const candidates = prev.candidates.map((x) => (x.id === c.id ? { ...x, decision: d, decidedBy: "owner" as const } : x));
        return { candidates, stats: restat(prev.stats, candidates) };
      });
    apply(decision);
    const r = await postJson("/api/personas/voice", { id: c.id, decision });
    if (!r.ok) apply(c.decision);
    setRowError((e) => ({ ...e, [c.id]: r.ok ? "" : failReason(r) }));
  };

  const { stats } = data;
  return (
    <div className="mx-auto max-w-[900px] space-y-5" data-persona={persona}>
      <LearnHeader title="말투 재료" sub="배우면 안 되는 표현이 걸린 답부터 골라요" />
      <Summary stats={stats} />
      {data.candidates.length ? (
        <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-neutral-950/5">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-4 px-5 py-2.5 text-[11.5px] font-medium text-neutral-400">
            <span>댓글</span>
            <span>내 답 · 걸린 문구</span>
            <span className="w-[168px]">결정</span>
          </div>
          <ul>
            {data.candidates.map((c) => (
              <VoiceRow key={c.id} c={c} error={rowError[c.id]} onDecide={decide} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-xl bg-neutral-950/[0.03] px-4 py-3 text-[13px] text-neutral-600">걸린 답이 없어요. 모든 답이 말투 재료로 쓰여요.</p>
      )}
    </div>
  );
}

function Summary({ stats }: { stats: VoiceData["stats"] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-2xl bg-white px-5 py-4 ring-1 ring-neutral-950/5">
      <p className="text-[13px] text-neutral-600">
        <span className="mr-1 text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-neutral-900">
          <NumberFlow value={remainingMaterial(stats)} />
        </span>
        / <span className="tabular-nums">{stats.total}</span>개 답이 말투 재료로 남아요
      </p>
      <p className="text-[12px] tabular-nums text-neutral-500">
        검토 대상 {stats.flagged} · 제외 {stats.excluded} · 유지 {stats.kept} · 가리기 {stats.masked}
      </p>
    </div>
  );
}

function VoiceRow({ c, error, onDecide }: { c: VoiceCandidate; error?: string; onDecide: (c: VoiceCandidate, d: ExclusionDecision) => void }) {
  const out = c.decision === "exclude";
  return (
    <li data-voice={c.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-start gap-4 px-5 py-3.5 text-[12.5px] leading-relaxed shadow-[0_-1px_0_0_rgba(10,10,10,0.05)]">
      <p className="line-clamp-4 whitespace-pre-line break-keep text-neutral-500">{c.comment}</p>
      <p className={cn("whitespace-pre-line break-keep transition-opacity duration-150", out ? "text-neutral-400" : "text-neutral-800")}>
        <Painted c={c} />
      </p>
      <div className="w-[168px]">
        {c.locked ? (
          <p className="flex items-center gap-1.5 rounded-lg bg-neutral-950/[0.04] px-2.5 py-1.5 text-[12px] text-neutral-600" title="처방약 선택·용량 답은 늘 빼요">
            <LockClosedIcon className="size-3.5 shrink-0 text-neutral-500" aria-hidden />
            제외 고정
          </p>
        ) : (
          <Segmented value={c.decision} onChange={(d) => onDecide(c, d)} />
        )}
        {error ? <p className="mt-1 text-[11.5px] text-amber-700">{error}</p> : null}
      </div>
    </li>
  );
}

function Painted({ c }: { c: VoiceCandidate }) {
  return (
    <>
      {phraseSegments(c.reply, c.reasons).map((s, i) =>
        s.reason ? (
          <mark key={i} title={s.reason.kind} className={cn("rounded-[3px] px-0.5 text-inherit", c.decision === "mask" ? "bg-neutral-800 text-transparent" : "bg-amber-200/70")}>
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
      <span className="mt-1 block text-[11px] text-neutral-400">{[...new Set(c.reasons.map((r) => r.kind))].join(" · ")}</span>
    </>
  );
}

function Segmented({ value, onChange }: { value: ExclusionDecision; onChange: (d: ExclusionDecision) => void }) {
  return (
    <div role="radiogroup" aria-label="결정" className="inline-flex rounded-lg bg-neutral-950/[0.05] p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-md px-2.5 text-[12px] font-medium transition-[background-color,color,box-shadow] duration-150",
            value === o.value ? (o.value === "exclude" ? "bg-neutral-900 text-white" : "bg-white text-neutral-900 shadow-[0_1px_2px_rgba(10,10,10,0.08)]") : "text-neutral-500 hover:text-neutral-800"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
