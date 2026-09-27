// 앱이 켜져 있는 동안 정해진 간격으로 도는 일. (맥 예약 작업을 설치하지 않아도 되게 앱 안에 둔다.)
//   - 토큰 연장: 하루 한 번 (60일 토큰이 끊기지 않게)
//   - 새 댓글 가져오기 + 초안 쓰기: 10분마다 (마지막 동기화가 10분 넘었을 때만)
//   - 내 글 보관함 갱신: 하루 한 번 (근거 "지난 글"과 말투 만들기가 쓴다)
// 계정이 연결되지 않았으면 아무것도 하지 않는다.
import { readStoredToken } from "@/lib/threads-archive/storage";

const INTERVAL_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

async function tick(lastArchive: { at: number }): Promise<void> {
  if (!(await readStoredToken())) return;
  const [{ refreshTokenIfNeeded }, { syncIfStale }, { ensureAnswers }, { startSync }] = await Promise.all([
    import("@/lib/threads-archive/graph"),
    import("@/lib/threads-replies/sync"),
    import("@/lib/threads-replies/answer-job"),
    import("@/lib/threads-archive/sync"),
  ]);
  await refreshTokenIfNeeded();
  await syncIfStale();
  void ensureAnswers("all").catch((e) => console.error("[초안] 실패:", e));
  if (Date.now() - lastArchive.at > DAY_MS) {
    lastArchive.at = Date.now();
    startSync();
  }
}

export function startScheduler(): void {
  // 개발 모드의 코드 새로고침이 타이머를 겹쳐 띄우지 않게 globalThis 에 한 번만 둔다.
  const g = globalThis as typeof globalThis & { __threadsRepliesScheduler?: NodeJS.Timeout };
  if (g.__threadsRepliesScheduler || process.env.THREADS_REPLIES_DISABLE_SCHEDULER === "1") return;
  const lastArchive = { at: 0 };
  const run = () => {
    tick(lastArchive).catch((error: unknown) => console.error("[예약 작업] 실패:", error));
  };
  g.__threadsRepliesScheduler = setInterval(run, INTERVAL_MS);
  setTimeout(run, 5_000);
}
