// 답 초안 잡의 차례 (10-02 henry "왜 '쓰는 중'이 계속 떠 있는지").
// 잡은 만들 때 정한 순서(최신순)를 끝까지 고집해서, 화면이 오래된 순으로 보여 주는 위쪽 댓글이 맨 마지막 차례였다.
// 이제 한 건 끝날 때마다 다음 차례를 다시 고르고, 화면이 지금 볼 댓글을 앞으로 당길 수 있다.

interface Queue {
  replyIds: string[];
  done: string[];
  failed: { replyId: string }[];
}

function finished(job: Queue): Set<string> {
  return new Set([...job.done, ...job.failed.map((f) => f.replyId)]);
}

/** 아직 안 끝났고 다른 일꾼이 쓰고 있지 않은(busy) 첫 댓글. 없으면 null. */
export function nextAnswerId(job: Queue, busy: ReadonlySet<string> = new Set()): string | null {
  const over = finished(job);
  return job.replyIds.find((id) => !over.has(id) && !busy.has(id)) ?? null;
}

/** ids 중 안 끝난 것을 넘긴 순서대로 줄 맨 앞에 세운다 (끝난 것은 제자리 — 다시 쓰지 않는다). */
export function frontLoad<T extends Queue>(job: T, ids: readonly string[]): T {
  const over = finished(job);
  const front = [...new Set(ids)].filter((id) => !over.has(id));
  const rest = job.replyIds.filter((id) => !front.includes(id));
  const doneFirst = rest.filter((id) => over.has(id));
  const waiting = rest.filter((id) => !over.has(id));
  return { ...job, replyIds: [...doneFirst, ...front, ...waiting] };
}
