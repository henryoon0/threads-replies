// 댓글 모두 건너뛰기 — 로컬 원장에 "건너뜀" 표시만 한다. 스레드에는 아무것도 보내지 않는다.
// 되돌리기용으로 이번에 건너뛴 id 목록을 돌려준다.
import { isPending } from "./model";
import { updateRepliesLedger } from "./storage";

/** 답할 차례인 댓글 전부(ids 를 주면 그중에서만)를 건너뛴다. */
export async function skipPendingReplies(ids?: readonly string[]): Promise<string[]> {
  const only = ids ? new Set(ids) : null;
  const skipped: string[] = [];
  await updateRepliesLedger((ledger) => ({
    ...ledger,
    replies: ledger.replies.map((r) => {
      if (!isPending(r) || (only && !only.has(r.id))) return r;
      skipped.push(r.id);
      return { ...r, skipped: true };
    }),
  }));
  return skipped;
}

/** 모두 건너뛰기 되돌리기 — 그 목록만 되살린다. 그사이 답한 댓글은 건드리지 않는다. */
export async function restoreSkippedReplies(ids: readonly string[]): Promise<number> {
  const want = new Set(ids);
  let restored = 0;
  await updateRepliesLedger((ledger) => ({
    ...ledger,
    replies: ledger.replies.map((r) => {
      if (!want.has(r.id) || !r.skipped || r.myReply) return r;
      restored += 1;
      return { ...r, skipped: undefined };
    }),
  }));
  return restored;
}
