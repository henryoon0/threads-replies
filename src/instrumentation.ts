// 서버 시작 훅 — 멈췄던 작업 재개(sweep)와 예약 작업을 띄운다.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ startSweepScheduler }, { registerThreadsRepliesSweep }, { registerThreadsArchiveSweep }, { startScheduler }] =
    await Promise.all([
      import("@/lib/jobs/sweep"),
      import("@/lib/threads-replies/answer-job"),
      import("@/lib/threads-archive/sweep"),
      import("@/lib/scheduler"),
    ]);
  registerThreadsRepliesSweep();
  registerThreadsArchiveSweep();
  await startSweepScheduler();
  startScheduler();
}
