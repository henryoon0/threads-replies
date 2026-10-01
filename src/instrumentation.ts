// 서버 시작 훅 — 멈췄던 작업 재개(sweep)와 예약 작업을 띄운다.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ startSweepScheduler }, { registerThreadsRepliesSweep }, { registerThreadsArchiveSweep }, { startScheduler }, { registerSendQueueSweep }] =
    await Promise.all([
      import("@/lib/jobs/sweep"),
      import("@/lib/threads-replies/answer-job"),
      import("@/lib/threads-archive/sweep"),
      import("@/lib/scheduler"),
      import("@/lib/threads-replies/send-queue"),
    ]);
  registerThreadsRepliesSweep();
  registerThreadsArchiveSweep();
  // 답글 보내기 대기열: 화면을 떠나도·앱이 다시 켜져도 보낸다
  registerSendQueueSweep();
  await startSweepScheduler();
  startScheduler();
}
