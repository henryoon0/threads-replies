// 스레드 쪽 레일에서 고를 수 있는 곳: 받은함 보기 3개(threads-view.ts) + 학습 보기 4개.
// 학습 보기 = 시안 픽 4(말투 재료)·16(주간 검토)·17(규칙 정리)·18(성과).
import type { ThreadsView } from "./threads-view";

export type LearnView = "review" | "rules" | "progress" | "voice";
export type ThreadsPlace = ThreadsView | LearnView;

export const LEARN_VIEWS: readonly LearnView[] = ["review", "rules", "progress", "voice"];

export function isLearnView(p: ThreadsPlace): p is LearnView {
  return (LEARN_VIEWS as readonly string[]).includes(p);
}
