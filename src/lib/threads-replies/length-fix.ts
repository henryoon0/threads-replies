// 길이 관문: 짧게·길게 역할을 못 지킨 벌만 한 번씩 다시 쓴다 (같은 세션, 한 벌씩 차례로).
// 다시 쓴 벌이 목표를 지키거나 더 가까워졌을 때만 바꾼다. 실패하면 앞 벌을 그대로 둔다 (초안은 늘 3벌).

import type { DraftOption, LengthRole } from "./model";
import { charLength, closerToRole, fitsRole, lengthMisses, type LengthPlan } from "./length-plan";

export async function fixLengths(
  options: readonly DraftOption[],
  roles: readonly (LengthRole | undefined)[],
  plan: LengthPlan,
  rewrite: (index: number, current: readonly DraftOption[]) => Promise<DraftOption | null>
): Promise<DraftOption[]> {
  let out = [...options];
  for (const i of lengthMisses(out.map((o) => o.draft), roles, plan)) {
    const role = roles[i];
    if (!role) continue;
    const next = await rewrite(i, out).catch((e: unknown) => {
      const err = e as Error | undefined;
      // 취소·시간 초과는 그대로 올린다
      if (err?.name === "CancelledError" || /시간 초과|timed? ?out/i.test(err?.message ?? "")) throw e;
      return null;
    });
    if (!next?.draft.trim()) continue;
    if (fitsRole(charLength(next.draft), role, plan) || closerToRole(out[i].draft, next.draft, role, plan)) {
      out = out.map((o, j) => (j === i ? { ...next, lengthRole: role } : o));
    }
  }
  return out;
}
