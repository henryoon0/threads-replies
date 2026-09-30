"use client";

// "이번 주 분석 돌리기" 버튼. 잡이 도는 동안 단계·경과 시간을 보여 주고 4초마다 다시 읽는다 (4~8분 걸림).
import { useEffect, useState } from "react";
import { ArrowPathIcon } from "@heroicons/react/16/solid";
import { agoLabel, elapsedLabel, failReason, jobPhaseLabel, postJson, type LearningJob } from "./learn-data";
import { btnQuiet } from "./learn-parts";

export function RunJobButton({ job, lastRunAt, onTick }: { job: LearningJob | null; lastRunAt: string | null; onTick: () => void }) {
  const running = job?.status === "running";
  const [now, setNow] = useState(() => Date.now());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!running) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(onTick, 4000);
    return () => {
      clearInterval(clock);
      clearInterval(poll);
    };
  }, [running, onTick]);

  const start = async () => {
    setStarting(true);
    setError(null);
    const r = await postJson("/api/personas/learning/run", {});
    if (!r.ok) setError(failReason(r));
    setStarting(false);
    setNow(Date.now());
    onTick();
  };

  if (running && job) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl bg-white px-3 py-2 text-[12.5px] ring-1 ring-neutral-950/5" role="status" aria-live="polite">
        <span className="relative flex size-2">
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/60 motion-reduce:hidden" />
          <span className="relative size-2 rounded-full bg-emerald-500" />
        </span>
        <span className="font-medium text-neutral-800">{jobPhaseLabel(job)}</span>
        <span className="tabular-nums text-neutral-400">{elapsedLabel(job.startedAt, now)} · 보통 4~8분</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] text-neutral-400">
        {error ? <span className="text-amber-700">{error}</span> : job?.status === "failed" ? <span className="text-amber-700">지난 분석이 실패했어요</span> : `마지막 분석 ${agoLabel(lastRunAt, now)}`}
      </span>
      <button type="button" onClick={start} disabled={starting} className={btnQuiet}>
        <ArrowPathIcon className="size-4" aria-hidden />
        이번 주 분석 돌리기
      </button>
    </div>
  );
}
