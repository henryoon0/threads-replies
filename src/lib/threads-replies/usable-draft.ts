// 화면에 "답"으로 보여 줄 수 있는 초안인가 (10-02 henry: "초안이 생성된 게 없는데 결과물이 보인다 — 제대로 안 된 결과물").
// 예전 답 초안 잡(3벌, 지금은 꺼짐)이 남긴 글은 버전 버튼과 이어지지 않는다. 버전 글(compose)이나 주인이 고친 글만 쓴다.
import type { ReplyAnswer } from "./model";

/** 옛 3벌 잡이 남긴 글: 3벌(options)은 있는데 버전 글 표시(compose)가 없고, 주인이 고치지도 않았다 */
export function isStaleJobDraft(answer: ReplyAnswer | undefined): boolean {
  if (!answer?.options?.length || "compose" in answer) return false;
  const edited = answer.aiDraft !== undefined && answer.draft.trim() !== answer.aiDraft.trim();
  return !edited && answer.model !== "henry";
}

/** 보여 줄 초안 글. 쓸 수 없는 글이면 "" */
export function usableDraft(answer: ReplyAnswer | undefined): string {
  return answer && !isStaleJobDraft(answer) ? answer.draft : "";
}
