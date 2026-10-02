// 미리 쓰는 범위 (10-02 henry: "가장 오래 쌓인 것 기준으로 20개, 화면이 켜지자마자").
// 화면(threads-client 의 oldestBatch)과 서버(GET 목록)가 같은 20개를 고르도록 규칙을 여기 하나에 둔다.
import { isPending, type ThreadsRepliesLedger } from "./model";

export const PREP_BATCH = 20;

/** 답할 차례인 댓글 중 가장 오래된 n 개 (같은 시각이면 id 순) */
export function oldestPendingIds(ledger: Pick<ThreadsRepliesLedger, "replies">, n = PREP_BATCH): string[] {
  return ledger.replies
    .filter(isPending)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id))
    .slice(0, n)
    .map((r) => r.id);
}
