// 초안을 먼저 저장하고, 예전 답 대조(칠하기)는 끝나는 대로 나중에 붙인다 (2026-10-02 실측: 초안 46초 + 대조 16초).
// 대조는 참고 표시일 뿐이라 초안이 기다릴 이유가 없다. 늦게 도착한 대조는 같은 초안(generatedAt)일 때만 붙인다.
import type { ReplyAnswer } from "./model";

/** now = 지금 원장의 답, checked = 대조를 마친 그때의 답. 같은 초안이면 대조만 옮겨 붙인다. */
export function mergeLateConsistency(now: ReplyAnswer | undefined, checked: ReplyAnswer): ReplyAnswer | undefined {
  if (!now || now.generatedAt !== checked.generatedAt) return now;
  const options = now.options?.map((o, i) => {
    const c = checked.options?.[i];
    return c && c.draft === o.draft ? { ...o, consistency: c.consistency } : o;
  });
  const sameDraft = now.draft === checked.consistencyFor;
  return {
    ...now,
    ...(options ? { options } : {}),
    ...(sameDraft ? { consistency: checked.consistency, consistencyFor: checked.consistencyFor } : {}),
  };
}
