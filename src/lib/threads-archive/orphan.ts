import { defineOrphanRule } from "@/lib/jobs/orphan-rule";
import type { ThreadsSyncJob } from "./model";
import { isActiveState } from "./model";

// 고아 판정 — dev 서버 재시작 등으로 syncing 에 갇힌 잡을 찾는다.
// 규칙 뼈대는 jobs/orphan-rule.ts.
//
// 불변식: STALE_MS > 최장 단일 구간 + 여유.
// 여기서 최장 구간은 글 하나당 API 콜(인사이트 + 칸) 이고, graph.ts 가 30초로 자른다.
// 배치마다 patchJob 이 하트비트를 찍으므로 5분이면 넉넉하다.
export const STALE_MS = 5 * 60 * 1000;

// 동기화 잡은 하나뿐이라 id 가 없다 — 목록에서 고르는 findOrphanIds 는 안 만든다.
export const { isOrphan } = defineOrphanRule<ThreadsSyncJob>({
  isActive: (job) => isActiveState(job.state),
  staleMs: STALE_MS,
});
