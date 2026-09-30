"use client";

// 학습 · 규칙 정리 — 픽 17 "규칙책 히트맵". 규칙책 전체를 한 줄씩, 쓰인 정도로 칠한다.
// 옅은 줄(최근 분석에서 한 번도 안 쓰인 규칙)을 누르면 지우기 확인이 열린다. 잠긴 규칙은 못 지운다.
import { useState } from "react";
import { LockClosedIcon, TrashIcon } from "@heroicons/react/16/solid";
import { cn } from "@/lib/utils";
import { failReason, groupBySection, heatOf, postJson, useLearnJson, type Heat, type LearningOverview, type RuleRow } from "./learn-data";
import { btnQuiet, LearnError, LearnHeader, LearnLoading, TokenGauge } from "./learn-parts";

const TONE_RGB: Record<Heat["tone"], string> = {
  positive: "16,185,129", // emerald-500
  negative: "245,158,11", // amber-500
  mixed: "115,115,115", // neutral-500
  idle: "0,0,0",
};

export function heatStyle(h: Heat): React.CSSProperties | undefined {
  if (h.tone === "idle") return undefined;
  return { backgroundColor: `rgba(${TONE_RGB[h.tone]},${(0.05 + h.strength * (h.tone === "mixed" ? 0.1 : 0.16)).toFixed(3)})` };
}

export function LearnRules({ persona }: { persona: string }) {
  const { data, error, reload } = useLearnJson<LearningOverview>("/api/personas/learning");
  const [confirm, setConfirm] = useState<string | null>(null);

  if (!data) return error ? <LearnError message={error} onRetry={reload} /> : <LearnLoading />;
  const rules = data.rules;
  const faint = rules.filter((r) => heatOf(r).faint && !r.locked);
  const faintTokens = faint.reduce((s, r) => s + r.tokens, 0);

  return (
    <div className="mx-auto max-w-[760px] space-y-5" data-persona={persona}>
      <LearnHeader
        title="규칙 정리"
        sub={rules.length ? <span className="tabular-nums">규칙 {rules.length}개 · 안 쓰인 규칙 {faint.length}개 (약 {faintTokens.toLocaleString()} 토큰)</span> : "규칙책이 비어 있어요"}
      />
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <TokenGauge className="w-72" used={data.budget.tokens} cap={data.budget.cap} />
        <Legend />
      </div>
      {rules.length ? (
        <div className="rounded-2xl bg-white p-2 ring-1 ring-neutral-950/5">
          {groupBySection(rules).map((s, i) => (
            <section key={`${s.title}-${i}`} className={cn("px-2 pb-2", i > 0 && "pt-3 shadow-[0_-1px_0_0_rgba(10,10,10,0.05)]")}>
              <h3 className="px-2 pb-1.5 pt-1 text-[12px] font-semibold text-neutral-800">{s.title}</h3>
              <ol className="space-y-0.5">
                {s.rules.map((r) => (
                  <RuleLine key={r.id} rule={r} open={confirm === r.id} onOpen={setConfirm} onDeleted={reload} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Legend() {
  const chip = (tone: Heat["tone"], label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2.5 rounded-sm" style={{ backgroundColor: `rgba(${TONE_RGB[tone]},0.35)` }} aria-hidden />
      {label}
    </span>
  );
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-neutral-500">
      {chip("positive", "도움 된 규칙")}
      {chip("negative", "어긋난 규칙")}
      {chip("mixed", "둘 다")}
      <span className="text-neutral-400">옅은 줄은 최근 분석에서 한 번도 안 쓰였어요. 눌러서 지울 수 있어요</span>
    </p>
  );
}

function ruleTitle(r: RuleRow): string {
  return `${r.id} · 도움 ${r.positive} · 어긋남 ${r.negative} · 관련 대화 ${r.sessions} · ${r.tokens} 토큰`;
}

function RuleLine({ rule, open, onOpen, onDeleted }: { rule: RuleRow; open: boolean; onOpen: (id: string | null) => void; onDeleted: () => void }) {
  const heat = heatOf(rule);
  const deletable = heat.faint && !rule.locked;
  const text = (
    <>
      <span className="w-14 shrink-0 pt-px font-mono text-[10.5px] tabular-nums text-neutral-400">{rule.id}</span>
      <span className={cn("min-w-0 flex-1 whitespace-pre-wrap break-keep", heat.faint ? "text-neutral-400" : "text-neutral-800")}>{rule.text}</span>
      {rule.locked ? <LockClosedIcon className="mt-[3px] size-3.5 shrink-0 text-neutral-400" aria-label="잠긴 규칙" /> : null}
    </>
  );
  const base = "flex w-full gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] leading-relaxed";
  return (
    <li data-rule={rule.id} data-faint={heat.faint || undefined}>
      {deletable ? (
        <button type="button" title={ruleTitle(rule)} onClick={() => onOpen(open ? null : rule.id)} aria-expanded={open} className={cn(base, "transition-colors duration-150 hover:bg-neutral-950/[0.04]", open && "bg-neutral-950/[0.04]")}>
          {text}
        </button>
      ) : (
        <div title={ruleTitle(rule)} className={base} style={heatStyle(heat)}>
          {text}
        </div>
      )}
      {open ? <DeleteConfirm rule={rule} onCancel={() => onOpen(null)} onDeleted={onDeleted} /> : null}
    </li>
  );
}

function DeleteConfirm({ rule, onCancel, onDeleted }: { rule: RuleRow; onCancel: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    const r = await postJson("/api/personas/learning/rules", { id: rule.id, action: "delete", hash: rule.hash });
    setBusy(false);
    if (r.ok) onDeleted();
    else setError(failReason(r));
  };
  return (
    <div role="dialog" aria-label={`${rule.id} 지우기 확인`} className="mx-2 mb-2 mt-1 flex flex-wrap items-center gap-3 rounded-xl bg-neutral-950/[0.03] px-3.5 py-2.5 text-[12.5px]">
      <p className="min-w-0 flex-1 text-neutral-700">
        이 규칙을 지울까요? 관련 대화 {rule.sessions}번, 지우면 {rule.tokens} 토큰 줄어요. 팩에 커밋으로 남아요.
        {error ? <span className="mt-1 block text-amber-700">{error}</span> : null}
      </p>
      <button type="button" onClick={onCancel} className={cn(btnQuiet, "h-8")}>
        취소
      </button>
      <button type="button" disabled={busy} onClick={remove} className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-neutral-900 px-3 text-[12.5px] font-medium text-white transition-[background-color,scale] duration-150 hover:bg-neutral-800 active:scale-[0.96] disabled:opacity-50">
        <TrashIcon className="size-3.5" aria-hidden />
        지우기
      </button>
    </div>
  );
}
