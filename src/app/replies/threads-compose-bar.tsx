"use client";

// 답 버전 버튼 (2026-09-29 henry: "토글 느낌이 아니라, 버튼 하나에 여러 조각이 섞인 버전들이 여러 개").
// 완성된 답 칸 안(글 위)에 둔다. 버전 = 주인이 실제 답에서 조각을 섞는 방식 하나 (compose-presets.ts).
// 이 댓글에 맞는 순서로 놓고 위 둘에 "추천"을 단다. 미리 쓴 버전은 누르는 즉시 글이 바뀐다.
// 초안기(compose API)가 아직 없으면 버튼 없이 [새로 쓰기]만 옛 경로로 돈다.

import { ArrowPathIcon, CheckIcon } from "@heroicons/react/16/solid";
import { cn } from "@/lib/utils";
import { press } from "./threads-answer-verdict";
import type { ComposePresetView, ComposeStatus } from "./use-compose";

function versionTitle(preset: ComposePresetView, ready: boolean): string {
  const count = preset.count ? ` · 실제 답 ${preset.count}개가 이렇게 섞였어요` : "";
  return `${preset.parts}${count}${ready ? "" : " · 아직 쓰는 중"}`;
}

function versionTone(on: boolean, ready: boolean): string {
  if (on) return "bg-emerald-700 text-white hover:bg-emerald-800";
  return cn("bg-white ring-1 ring-neutral-950/10 hover:bg-neutral-950/[0.03]", ready ? "text-neutral-700" : "text-neutral-500");
}

function VersionIcon({ on, loading }: { on: boolean; loading: boolean }) {
  if (loading) return <ArrowPathIcon className="-ml-0.5 size-3.5 animate-spin" aria-hidden />;
  return on ? <CheckIcon className="-ml-0.5 size-3.5" aria-hidden /> : null;
}

function VersionButton({ preset, on, ready, loading, disabled, onClick }: { preset: ComposePresetView; on: boolean; ready: boolean; loading: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-busy={loading || undefined}
      disabled={disabled}
      title={versionTitle(preset, ready)}
      onClick={onClick}
      className={cn("inline-flex h-8 items-center gap-1 rounded-full px-3 text-[12.5px] font-medium disabled:opacity-50", versionTone(on, ready), press)}
    >
      <VersionIcon on={on} loading={loading} />
      {preset.name}
      {preset.recommended ? <span className={cn("ml-0.5 text-[10.5px] font-normal", on ? "text-white/75" : "text-emerald-700")}>추천</span> : null}
    </button>
  );
}

function barNote(status: ComposeStatus, busy: boolean, loading: boolean, note: string, selected: ComposePresetView | undefined): string {
  if (status === "missing") return "버전 초안기를 준비하는 중이에요. 지금은 새로 쓰기만 돼요";
  if (status === "working" || busy) return "다시 쓰는 중이에요";
  if (note) return note;
  if (loading) return "이 버전은 쓰는 중이에요. 다 되면 바로 바뀌어요";
  return selected ? `${selected.name}: ${selected.parts}` : "누르면 그 버전으로 쓴 답으로 바뀌어요";
}

export function ComposeBar({
  presets,
  selected,
  ready,
  status,
  note,
  busy,
  loadingId,
  onPick,
  onRewrite,
  onRestartAll,
  writingAll = false,
}: {
  presets: ComposePresetView[];
  selected: string | null;
  /** 미리 써 둔 버전 id */
  ready: ReadonlySet<string>;
  status: ComposeStatus;
  note: string;
  /** 옛 경로(다시 쓰기)가 도는 중 */
  busy: boolean;
  /** 눌렀는데 아직 쓰는 중인 버전 */
  loadingId: string | null;
  onPick: (id: string) => void;
  onRewrite: () => void;
  /** 이 댓글의 버전 전부 새로 (없으면 [전부] 버튼 없음) */
  onRestartAll?: () => void;
  /** 버전 전부를 다시 쓰는 중 */
  writingAll?: boolean;
}) {
  const working = status === "working" || busy || writingAll;
  const current = presets.find((p) => p.id === selected);
  // 고른 버전을 맨 앞에 둔다 (2026-10-01 henry). 나머지는 댓글에 맞는 순서(추천 먼저) 그대로.
  const ordered = current ? [current, ...presets.filter((p) => p.id !== current.id)] : presets;
  return (
    <div aria-label="답 버전" role="group" className="px-3 pt-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {ordered.map((p) => (
          <VersionButton key={p.id} preset={p} on={p.id === selected} ready={ready.has(p.id)} loading={loadingId === p.id || (writingAll && !ready.has(p.id))} disabled={working} onClick={() => onPick(p.id)} />
        ))}
        <RegenControls working={working} title={current ? `${current.name} 버전을 처음부터 다시 써요` : "처음부터 다시 써요"} onRewrite={onRewrite} onRestartAll={onRestartAll} />
      </div>
      <p className="mt-1.5 truncate text-[11.5px] text-neutral-500" aria-live="polite">
        {writingAll && !note ? "버전 전부 다시 쓰는 중이에요" : barNote(status, busy, Boolean(loadingId), note, current)}
      </p>
    </div>
  );
}

const ghost = cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40", press);

type RegenProps = { working: boolean; title: string; onRewrite: () => void; onRestartAll?: () => void };

/** 새로 쓰기: 지금 버전 하나 + [전부] = 이 댓글 버전 전부 (2026-09-30 henry 시안 픽 row). 5개 전부·줄마다는 지금 답할 5개 쪽에 있다. */
function RegenControls({ working, title, onRewrite, onRestartAll }: RegenProps) {
  return (
    <span className="ml-auto flex items-center">
      <button type="button" onClick={onRewrite} disabled={working} title={title} className={ghost}>
        <ArrowPathIcon className={cn("size-3.5", working && "animate-spin")} aria-hidden />
        새로 쓰기
      </button>
      {onRestartAll ? (
        <button type="button" onClick={onRestartAll} disabled={working} title="이 댓글의 버전 전부를 버리고 다시 써요" className={cn(ghost, "px-2 text-neutral-500 hover:text-emerald-700")}>
          전부
        </button>
      ) : null}
    </span>
  );
}
